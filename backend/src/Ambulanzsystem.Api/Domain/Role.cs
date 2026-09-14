namespace Ambulanzsystem.Api.Domain;

// D2: three distinct roles replace the recreation spec's AdminRole:bool.
public enum Role
{
    Admin,
    Leitstelle,
    Responder,
}

public enum AccountType
{
    Permanent,
    Event,
}
