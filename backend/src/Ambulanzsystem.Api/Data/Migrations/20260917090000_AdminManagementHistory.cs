using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260917090000_AdminManagementHistory")]
public partial class AdminManagementHistory : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "reason", table: "audit_logs", type: "character varying(500)", maxLength: 500, nullable: true);

        migrationBuilder.CreateTable(
            name: "ambulanzprotokoll_revisions",
            columns: table => new
            {
                id = table.Column<long>(type: "bigint", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                patient_id = table.Column<int>(type: "integer", nullable: false),
                version = table.Column<int>(type: "integer", nullable: false),
                form_state_snapshot = table.Column<string>(type: "jsonb", nullable: false),
                finalized_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                actor_id = table.Column<int>(type: "integer", nullable: true),
                actor_role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                correction_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_ambulanzprotokoll_revisions", x => x.id);
                table.ForeignKey("fk_ambulanzprotokoll_revisions_patients_patient_id", x => x.patient_id, "patients", "id", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateIndex("ix_ambulanzprotokoll_revisions_patient_id_version", "ambulanzprotokoll_revisions", new[] { "patient_id", "version" }, unique: true);

        // Existing finalized documents get their immutable baseline before any administrative
        // correction can append a later version.
        migrationBuilder.Sql(@"INSERT INTO ambulanzprotokoll_revisions (patient_id, version, form_state_snapshot, finalized_at, actor_role)
            SELECT patient_id, 1, form_state, COALESCE(finalized_at, updated_at), 'system'
            FROM ambulanzprotokoll_page1s WHERE status = 'finalized';");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "ambulanzprotokoll_revisions");
        migrationBuilder.DropColumn(name: "reason", table: "audit_logs");
    }
}
