using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProtokollProcessedWrites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "protokoll_processed_writes",
                columns: table => new
                {
                    patient_id = table.Column<int>(type: "integer", nullable: false),
                    write_id = table.Column<Guid>(type: "uuid", nullable: false),
                    checksum = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    processed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_protokoll_processed_writes", x => new { x.patient_id, x.write_id });
                    table.ForeignKey(
                        name: "fk_protokoll_processed_writes_patients_patient_id",
                        column: x => x.patient_id,
                        principalTable: "patients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "protokoll_processed_writes");
        }
    }
}
