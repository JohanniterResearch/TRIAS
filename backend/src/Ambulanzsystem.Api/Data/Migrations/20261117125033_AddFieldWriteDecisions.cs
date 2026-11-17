using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFieldWriteDecisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "decisions_json",
                table: "triage_processed_writes",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "decisions_json",
                table: "protokoll_processed_writes",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "decisions_json",
                table: "location_processed_writes",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "write_details_json",
                table: "audit_logs",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "decisions_json",
                table: "triage_processed_writes");

            migrationBuilder.DropColumn(
                name: "decisions_json",
                table: "protokoll_processed_writes");

            migrationBuilder.DropColumn(
                name: "decisions_json",
                table: "location_processed_writes");

            migrationBuilder.DropColumn(
                name: "write_details_json",
                table: "audit_logs");
        }
    }
}
