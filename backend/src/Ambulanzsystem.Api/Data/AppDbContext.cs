using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Organisation> Organisations => Set<Organisation>();
    public DbSet<OperationScene> OperationScenes => Set<OperationScene>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<Patient> Patients => Set<Patient>();
    public DbSet<Body> Bodies => Set<Body>();
    public DbSet<QrCodeLogin> QrCodeLogins => Set<QrCodeLogin>();
    public DbSet<QrCodePatient> QrCodePatients => Set<QrCodePatient>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AmbulanzprotokollPage1> AmbulanzprotokollPage1s => Set<AmbulanzprotokollPage1>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.Username).IsUnique();
            e.Property(x => x.Username).HasMaxLength(255).IsRequired();
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(32);
            e.Property(x => x.AccountType).HasConversion<string>().HasMaxLength(32);
            e.HasOne(x => x.EventScene).WithMany().HasForeignKey(x => x.EventSceneId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Organisation>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(255).IsRequired();
        });

        b.Entity<OperationScene>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(255).IsRequired();
            e.HasOne(x => x.Organisation).WithMany().HasForeignKey(x => x.OrganisationId).OnDelete(DeleteBehavior.SetNull);
            // D6: self-reference, one level of nesting enforced in the application layer (B3), not here.
            e.HasOne(x => x.ParentScene).WithMany(x => x.SubSites).HasForeignKey(x => x.ParentSceneId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Team>(e =>
        {
            e.Property(x => x.Name).IsRequired();
            e.HasOne(x => x.OperationScene).WithMany(x => x.Teams).HasForeignKey(x => x.OperationSceneId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.AssignedPatient).WithMany().HasForeignKey(x => x.AssignedPatientId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Patient>(e =>
        {
            e.Property(x => x.Triagefarbe).HasMaxLength(16);
            e.ToTable(t => t.HasCheckConstraint(
                "ck_patients_triagefarbe",
                "triagefarbe IN ('rot','gelb','gruen','schwarz')")); // D5: ASCII canonical, 'blau' invalid in V1
            e.HasIndex(x => x.ClientGeneratedId).IsUnique().HasFilter("client_generated_id IS NOT NULL");
            e.HasOne(x => x.OperationScene).WithMany(x => x.Patients).HasForeignKey(x => x.OperationSceneId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserIdUser).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Body>(e =>
        {
            e.Property(x => x.BodyPartsJson).HasColumnType("jsonb").HasColumnName("body_parts");
            e.HasIndex(x => x.PatientId).IsUnique();
            e.HasOne(x => x.Patient).WithOne(x => x.Body).HasForeignKey<Body>(x => x.PatientId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<QrCodeLogin>(e =>
        {
            e.HasIndex(x => x.QrToken).IsUnique();
            e.Property(x => x.QrToken).HasMaxLength(128).IsRequired();
            e.HasOne(x => x.EventScene).WithMany().HasForeignKey(x => x.EventSceneId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<QrCodePatient>(e =>
        {
            e.HasIndex(x => x.QrToken).IsUnique();
            e.Property(x => x.QrToken).HasMaxLength(128).IsRequired();
            e.HasIndex(x => x.PatientId).IsUnique().HasFilter("patient_id IS NOT NULL");
            e.HasOne(x => x.Patient).WithOne(x => x.QrCodePatient).HasForeignKey<QrCodePatient>(x => x.PatientId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.OperationScene).WithMany().HasForeignKey(x => x.OperationSceneId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<RefreshToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();
            e.HasOne(x => x.User).WithMany(x => x.RefreshTokens).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AmbulanzprotokollPage1>(e =>
        {
            e.Property(x => x.FormStateJson).HasColumnType("jsonb").HasColumnName("form_state");
            e.Property(x => x.Status).HasMaxLength(32);
            e.HasIndex(x => x.PatientId).IsUnique();
            e.HasOne(x => x.Patient).WithOne(x => x.AmbulanzprotokollPage1).HasForeignKey<AmbulanzprotokollPage1>(x => x.PatientId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AuditLog>(e =>
        {
            e.Property(x => x.ChangedFieldsJson).HasColumnType("jsonb").HasColumnName("changed_fields");
            e.Property(x => x.BeforeJson).HasColumnType("jsonb").HasColumnName("before");
            e.Property(x => x.AfterJson).HasColumnType("jsonb").HasColumnName("after");
            e.HasIndex(x => x.PatientId);
            e.HasIndex(x => x.Timestamp);
            // Append-only (D7): no delete/update path is ever wired up in application code.
        });
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        StampTimestamps();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        StampTimestamps();
        return base.SaveChangesAsync(cancellationToken);
    }

    private void StampTimestamps()
    {
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAt = now;
                entry.Entity.UpdatedAt = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
            }
        }
    }
}
