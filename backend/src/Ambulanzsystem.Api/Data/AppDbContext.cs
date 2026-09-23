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
    public DbSet<AmbulanzprotokollExport> AmbulanzprotokollExports => Set<AmbulanzprotokollExport>();
    public DbSet<AmbulanzprotokollRevision> AmbulanzprotokollRevisions => Set<AmbulanzprotokollRevision>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.Username).IsUnique();
            e.Property(x => x.Username).HasMaxLength(255).IsRequired();
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(32);
            e.Property(x => x.AccountType).HasConversion<string>().HasMaxLength(32);
            e.HasOne(x => x.EventScene).WithMany().HasForeignKey(x => x.EventSceneId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Organisation>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(255).IsRequired();
        });

        b.Entity<OperationScene>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(255).IsRequired();
            e.Property(x => x.Description).HasMaxLength(2000);
            e.HasOne(x => x.Organisation).WithMany().HasForeignKey(x => x.OrganisationId).OnDelete(DeleteBehavior.SetNull);
            // D6: self-reference, one level of nesting enforced in the application layer (B3), not here.
            e.HasOne(x => x.ParentScene).WithMany(x => x.SubSites).HasForeignKey(x => x.ParentSceneId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Team>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(255).IsRequired();
            e.Property(x => x.Status).HasMaxLength(32);
            e.Property(x => x.AssignedLocation).HasMaxLength(255);
            e.Property(x => x.ContactInfo).HasMaxLength(255);
            e.HasOne(x => x.OperationScene).WithMany(x => x.Teams).HasForeignKey(x => x.OperationSceneId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.AssignedPatient).WithMany().HasForeignKey(x => x.AssignedPatientId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Patient>(e =>
        {
            e.Property(x => x.HumanReadableId).HasMaxLength(64);
            e.Property(x => x.Name).HasMaxLength(255);
            e.Property(x => x.Triagefarbe).HasMaxLength(16);
            e.Property(x => x.LocationSource).HasMaxLength(255);
            e.Property(x => x.IndoorLocation).HasMaxLength(255);
            e.Property(x => x.FieldTimestampsJson)
                .HasColumnType("jsonb")
                .HasColumnName("field_timestamps")
                .HasDefaultValue("{}");
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
            e.Property(x => x.FieldTimestampsJson)
                .HasColumnType("jsonb")
                .HasColumnName("field_timestamps")
                .HasDefaultValue("{}");
            e.Property(x => x.Status).HasMaxLength(32);
            e.HasIndex(x => x.PatientId).IsUnique();
            e.HasOne(x => x.Patient).WithOne(x => x.AmbulanzprotokollPage1).HasForeignKey<AmbulanzprotokollPage1>(x => x.PatientId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AmbulanzprotokollExport>(e =>
        {
            e.Property(x => x.FormStateSnapshotJson).HasColumnType("jsonb").HasColumnName("form_state_snapshot");
            e.Property(x => x.Status).HasMaxLength(32);
            e.Property(x => x.Watermark).IsRequired();
            e.HasIndex(x => x.PatientId);
            e.HasOne(x => x.Patient).WithMany().HasForeignKey(x => x.PatientId).OnDelete(DeleteBehavior.Restrict);
            // Archive rows are never updated or deleted (FR-DOC-14) — no update path exists in code.
        });

        b.Entity<AmbulanzprotokollRevision>(e =>
        {
            e.Property(x => x.FormStateSnapshotJson).HasColumnType("jsonb").HasColumnName("form_state_snapshot");
            e.Property(x => x.ActorRole).HasMaxLength(32);
            e.Property(x => x.CorrectionReason).HasMaxLength(500);
            e.HasIndex(x => new { x.PatientId, x.Version }).IsUnique();
            e.HasOne<Patient>().WithMany().HasForeignKey(x => x.PatientId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AuditLog>(e =>
        {
            e.Property(x => x.ChangedFieldsJson).HasColumnType("jsonb").HasColumnName("changed_fields");
            e.Property(x => x.BeforeJson).HasColumnType("jsonb").HasColumnName("before");
            e.Property(x => x.AfterJson).HasColumnType("jsonb").HasColumnName("after");
            e.Property(x => x.Reason).HasMaxLength(500);
            e.HasIndex(x => x.PatientId);
            e.HasIndex(x => x.Timestamp);
            // Append-only (D7): no delete/update path is ever wired up in application code.
        });

        b.SharedTypeEntity<Dictionary<string, string>>("OperationalMetadata", e =>
        {
            e.IndexerProperty<string>("Key").HasColumnName("key");
            e.IndexerProperty<string>("Value").HasColumnName("value").IsRequired();
            e.HasKey("Key");
            e.ToTable("operational_metadata", t => t.HasCheckConstraint(
                "ck_operational_metadata_deployment_id",
                "\"key\" = 'deployment_id'"));
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
