FROM nginx:1.28-alpine
ARG DEPLOY_COMMIT
ARG BRANCH
ARG REPO_URL
ARG RELEASE_ID
LABEL org.opencontainers.image.revision=$DEPLOY_COMMIT \
      org.opencontainers.image.source=$REPO_URL \
      trackingtrucks.branch=$BRANCH \
      trackingtrucks.release=$RELEASE_ID
COPY nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/
COPY release.json /usr/share/nginx/html/release.json
USER 1000:1000
EXPOSE 5173
ENTRYPOINT ["nginx", "-g", "daemon off;"]
