properties([
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(numToKeepStr: '15')),
    pipelineTriggers([cron('TZ=America/New_York\n59 23 * * *')])
])

timeout(time: 30, unit: 'MINUTES') {
    podTemplate(
        cloud: 'kubernetes', namespace: 'staging', podRetention: never(),
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
      image: node:24.22.2-bookworm
      # Temporary workaround for host AppArmor stacked-profile signal denials.
      securityContext:
        appArmorProfile: {type: Unconfined}
      workingDir: /home/jenkins/agent
      command: ["sleep", "infinity"]
      env:
        - name: BUILD_NODE
          valueFrom: {fieldRef: {fieldPath: spec.nodeName}}
      envFrom:
        - configMapRef: {name: deploy-code-settings}
        - secretRef: {name: frontend-env}
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
        - {name: BUILDKITD_FLAGS, value: '--oci-worker-no-process-sandbox --oci-worker-snapshotter=native'}
      securityContext:
        seccompProfile: {type: Unconfined}
        appArmorProfile: {type: Unconfined}
      resources:
        requests: {cpu: 100m, memory: 256Mi}
        limits: {cpu: "2", memory: 2Gi}
      volumeMounts:
        - {name: buildkit-state, mountPath: /home/user/.local/share/buildkit}
    - name: runtime
      image: rancher/k3s:v1.36.4-k3s1
      workingDir: /home/jenkins/agent
      command: ["/bin/sh", "-c", "sleep infinity"]
      securityContext: {runAsUser: 0, runAsGroup: 0}
      volumeMounts:
        - {name: containerd, mountPath: /run/k3s/containerd/containerd.sock}
  volumes:
    - name: containerd
      hostPath: {path: /run/k3s/containerd/containerd.sock, type: Socket}
    - name: scripts
      configMap: {name: deploy-code-scripts}
    - name: buildkit-state
      emptyDir: {}
'''
    ) {
        node(POD_LABEL) {
            env.RELEASE_ID = 'build-' + env.BUILD_NUMBER + '-' + sh(script: 'date -u +%Y%m%dT%H%M%S', returnStdout: true).trim()
            env.BRANCH = 'development'
            env.REPO_URL = '__REPO_URL__'
            env.SELECTED_IMAGE = ''
            env.IMAGE_REPOSITORY = 'localhost/trackingtrucks-staging'
            container('build') {
                stage('Checkout development') {
                    deleteDir()
                    def revision = checkout([
                        $class: 'GitSCM',
                        branches: [[name: '*/development']],
                        userRemoteConfigs: [[url: env.REPO_URL, credentialsId: '__GIT_CREDENTIALS_ID__',
                            refspec: '+refs/heads/development:refs/remotes/origin/development']],
                        extensions: [[$class: 'CloneOption', shallow: false, noTags: true, honorRefspec: true]]
                    ])
                    env.DEPLOY_COMMIT = revision.GIT_COMMIT
                    sh('git merge-base --is-ancestor "$DEPLOY_COMMIT" origin/development')
                }
                stage('Compile application') {
                    sh('bash /opt/deploy-code/compile-application.sh')
                    env.BUILD_IMAGE = env.IMAGE_REPOSITORY + ':release-' + env.RELEASE_ID
                }
            }
            stage('Deploy staging') {
                container('buildkit') {
                    sh '''
                        buildctl-daemonless.sh build --frontend dockerfile.v0 \
                          --local context=image-context --local dockerfile=image-context \
                          --opt "build-arg:DEPLOY_COMMIT=$DEPLOY_COMMIT" \
                          --opt "build-arg:BRANCH=$BRANCH" --opt "build-arg:REPO_URL=$REPO_URL" \
                          --opt "build-arg:RELEASE_ID=$RELEASE_ID" \
                          --output "type=oci,name=$BUILD_IMAGE,dest=image.tar" \
                          --metadata-file image-metadata.json
                    '''
                }
                def metadata = readJSON(file: 'image-metadata.json')
                def digest = metadata['containerimage.digest']
                if (!(digest ==~ /sha256:[0-9a-f]{64}/)) { error('Builder did not return an image digest') }
                env.DEPLOY_IMAGE = env.IMAGE_REPOSITORY + '@' + digest
                container('runtime') {
                    sh '''
                        ctr --address /run/k3s/containerd/containerd.sock --namespace k8s.io images import --local --digests --label io.cri-containerd.image=managed --base-name "$IMAGE_REPOSITORY" image.tar
                        ctr --address /run/k3s/containerd/containerd.sock --namespace k8s.io images inspect "$DEPLOY_IMAGE"
                    '''
                }
                container('build') {
                    currentBuild.description = 'development ' + env.DEPLOY_COMMIT.take(12)
                    sh('bash /opt/deploy-code/deploy-code.sh')
                }
            }
        }
    }
}
