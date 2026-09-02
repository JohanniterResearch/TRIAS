using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Data;

public static class RowLocks
{
    public static Task<User?> UserAsync(AppDbContext db, int id) =>
        db.Users.FromSqlInterpolated($"SELECT * FROM users WHERE id = {id} FOR UPDATE").SingleOrDefaultAsync();

    public static Task<Patient?> PatientAsync(AppDbContext db, int id) =>
        db.Patients.FromSqlInterpolated($"SELECT * FROM patients WHERE id = {id} FOR UPDATE").SingleOrDefaultAsync();

    public static Task<Body?> BodyAsync(AppDbContext db, int patientId) =>
        db.Bodies.FromSqlInterpolated($"SELECT * FROM bodies WHERE patient_id = {patientId} FOR UPDATE").SingleOrDefaultAsync();
}
