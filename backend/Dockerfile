# Build context is the repo root (see docker-compose.yml `build.context`) because the API
# project links contract/*.json files that live outside backend/.
FROM node:24-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY frontend/ frontend/
COPY contract/body-regions.json contract/body-regions.json
RUN cd frontend && npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY backend/Directory.Packages.props backend/Ambulanzsystem.slnx backend/
COPY backend/src/Ambulanzsystem.Api/Ambulanzsystem.Api.csproj backend/src/Ambulanzsystem.Api/
RUN dotnet restore backend/src/Ambulanzsystem.Api/Ambulanzsystem.Api.csproj
COPY backend/src/Ambulanzsystem.Api/ backend/src/Ambulanzsystem.Api/
COPY contract/ contract/
RUN dotnet publish backend/src/Ambulanzsystem.Api/Ambulanzsystem.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
COPY --from=frontend /src/frontend/dist/ambulanzsystem-frontend/browser/ wwwroot/
ENV ASPNETCORE_ENVIRONMENT=Production
ENTRYPOINT ["dotnet", "Ambulanzsystem.Api.dll"]
