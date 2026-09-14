using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOperationalMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "operational_metadata",
                columns: table => new
                {
                    key = table.Column<string>(type: "text", nullable: false),
                    value = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_operational_metadata", x => x.key);
                    table.CheckConstraint("ck_operational_metadata_deployment_id", "\"key\" = 'deployment_id'");
                });

            migrationBuilder.Sql("""
                CREATE FUNCTION operational_metadata_reject_changes() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'operational_metadata is immutable';
                END;
                $$;
                CREATE TRIGGER operational_metadata_reject_changes
                BEFORE UPDATE OR DELETE ON operational_metadata
                FOR EACH ROW EXECUTE FUNCTION operational_metadata_reject_changes();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER operational_metadata_reject_changes ON operational_metadata;
                DROP FUNCTION operational_metadata_reject_changes();
                """);

            migrationBuilder.DropTable(
                name: "operational_metadata");
        }
    }
}
