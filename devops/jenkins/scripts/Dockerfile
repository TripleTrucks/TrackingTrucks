FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim
ARG DEPLOY_COMMIT
ARG BRANCH
ARG REPO_URL
ARG RELEASE_ID
LABEL org.opencontainers.image.revision=$DEPLOY_COMMIT \
      org.opencontainers.image.source=$REPO_URL \
      trackingtrucks.branch=$BRANCH \
      trackingtrucks.release=$RELEASE_ID
WORKDIR /app
COPY app/ ./
COPY release.json ./wwwroot/release.json
ENV ASPNETCORE_URLS=http://0.0.0.0:5173 \
    ASPNETCORE_ENVIRONMENT=Production \
    HOME=/tmp
USER 1000:1000
EXPOSE 5173
ENTRYPOINT ["dotnet", "Backend.dll"]
