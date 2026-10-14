properties([
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(numToKeepStr: '30')),
    parameters([
        string(name: 'IMAGE', defaultValue: '', description: 'Saved repository@sha256:digest from a successful build. Blank builds BRANCH.'),
        string(name: 'REPO_URL', defaultValue: 'git@github.com:ZenMastering/TrackingTrucks.git', description: 'Git repository SSH URL'),
        string(name: 'BRANCH', defaultValue: 'main', description: 'Branch to build when IMAGE is blank'),
        string(name: 'GIT_CREDENTIALS_ID', defaultValue: 'github-ssh', description: 'Jenkins SSH credential ID')
    ])
])

timeout(time: 40, unit: 'MINUTES') {
    podTemplate(
        cloud: 'kubernetes', namespace: 'production', podRetention: never(),
        yaml: '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: deploy-code
  securityContext: {runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000}
  containers:
    - name: jnlp
      image: jenkins/inbound-agent:jdk21
      workingDir: /home/jenkins/agent
    - name: build
      image: node:24-bookworm
      workingDir: /home/jenkins/agent
      command: ["sleep", "infinity"]
      envFrom:
        - configMapRef: {name: registry-settings}
        - configMapRef: {name: deploy-code-settings}
      resources:
        requests: {cpu: 100m, memory: 256Mi}
        limits: {cpu: "2", memory: 2Gi}
      volumeMounts:
        - {name: scripts, mountPath: /opt/deploy-code, readOnly: true}
    - name: buildkit
      image: moby/buildkit:v0.23.2-rootless
      workingDir: /home/jenkins/agent
      command: ["sh", "-c", "sleep infinity"]
      env:
        - {name: DOCKER_CONFIG, value: /registry-auth}
        - {name: BUILDKITD_FLAGS, value: '--oci-worker-no-process-sandbox --oci-worker-snapshotter=native --config=/etc/buildkit/buildkitd.toml'}
      securityContext:
        seccompProfile: {type: Unconfined}
        appArmorProfile: {type: Unconfined}
      resources:
        requests: {cpu: 100m, memory: 256Mi}
        limits: {cpu: "2", memory: 2Gi}
      volumeMounts:
        - {name: registry-auth, mountPath: /registry-auth, readOnly: true}
        - {name: registry-ca, mountPath: /registry-ca, readOnly: true}
        - {name: buildkit-config, mountPath: /etc/buildkit, readOnly: true}
        - {name: buildkit-state, mountPath: /home/user/.local/share/buildkit}
  volumes:
    - name: scripts
      configMap: {name: deploy-code-scripts}
    - name: registry-auth
      secret:
        secretName: registry-jenkins
        items: [{key: .dockerconfigjson, path: config.json}]
    - name: registry-ca
      configMap: {name: registry-ca}
    - name: buildkit-config
      configMap: {name: registry-buildkit}
    - name: buildkit-state
      emptyDir: {}
'''
    ) {
        node(POD_LABEL) {
            env.RELEASE_ID = 'build-' + env.BUILD_NUMBER + '-' + sh(script: 'date -u +%Y%m%dT%H%M%S', returnStdout: true).trim()
            env.BRANCH = (params.BRANCH ?: 'main').trim()
            env.REPO_URL = params.REPO_URL
            env.SELECTED_IMAGE = (params.IMAGE ?: '').trim()
            def restore = env.SELECTED_IMAGE != ''
            container('build') {
                stage('Prepare release') {
                    deleteDir()
                    if (restore) {
                        env.DEPLOY_IMAGE = env.SELECTED_IMAGE
                        env.DEPLOY_COMMIT = ''
                        env.BRANCH = ''
                    } else {
                        sh('git check-ref-format "refs/heads/$BRANCH"')
                        def revision = checkout([
                            $class: 'GitSCM',
                            branches: [[name: 'refs/remotes/origin/' + env.BRANCH]],
                            userRemoteConfigs: [[url: params.REPO_URL, credentialsId: params.GIT_CREDENTIALS_ID,
                                refspec: '+refs/heads/' + env.BRANCH + ':refs/remotes/origin/' + env.BRANCH]],
                            extensions: [[$class: 'CloneOption', shallow: false, noTags: true, honorRefspec: true]]
                        ])
                        env.DEPLOY_COMMIT = revision.GIT_COMMIT
                    }
                }
                if (!restore) {
                    stage('Compile application') {
                        sh('bash /opt/deploy-code/compile-application.sh')
                        env.IMAGE_REPOSITORY = sh(script: 'printf %s "$IMAGE_REPOSITORY"', returnStdout: true).trim()
                        env.BUILD_IMAGE = env.IMAGE_REPOSITORY + ':' + env.RELEASE_ID
                    }
                }
            }
            if (!restore) {
                stage('Push artifacts') {
                    container('buildkit') {
                        sh '''
                            buildctl-daemonless.sh build --frontend dockerfile.v0 \
                              --local context=image-context --local dockerfile=image-context \
                              --opt "build-arg:DEPLOY_COMMIT=$DEPLOY_COMMIT" \
                              --opt "build-arg:BRANCH=$BRANCH" --opt "build-arg:REPO_URL=$REPO_URL" \
                              --opt "build-arg:RELEASE_ID=$RELEASE_ID" \
                              --output "type=image,name=$BUILD_IMAGE,push=true,oci-mediatypes=true" \
                              --metadata-file image-metadata.json
                        '''
                    }
                    def metadata = readJSON(file: 'image-metadata.json')
                    def digest = metadata['containerimage.digest']
                    if (!(digest ==~ /sha256:[0-9a-f]{64}/)) { error('Builder did not return an image digest') }
                    env.DEPLOY_IMAGE = env.IMAGE_REPOSITORY + '@' + digest
                }
            }
            container('build') {
                currentBuild.description = env.DEPLOY_IMAGE
                stage('Deploy and verify') {
                    sh('bash /opt/deploy-code/deploy-code.sh')
                }
                archiveArtifacts(artifacts: 'release.json', fingerprint: true)
                echo('Saved image for rollback: ' + env.DEPLOY_IMAGE)
            }
        }
    }
}
