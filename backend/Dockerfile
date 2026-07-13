# Build context is the repo root (see docker-compose.yml `build.context`) because the API
# project links contract/*.json files that live outside backend/.
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
ENV ASPNETCORE_ENVIRONMENT=Production
ENTRYPOINT ["dotnet", "Ambulanzsystem.Api.dll"]
