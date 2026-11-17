using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPatientCopiedFromPatientId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "copied_from_patient_id",
                table: "patients",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_patients_copied_from_patient_id",
                table: "patients",
                column: "copied_from_patient_id");

            migrationBuilder.AddForeignKey(
                name: "fk_patients_patients_copied_from_patient_id",
                table: "patients",
                column: "copied_from_patient_id",
                principalTable: "patients",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_patients_patients_copied_from_patient_id",
                table: "patients");

            migrationBuilder.DropIndex(
                name: "ix_patients_copied_from_patient_id",
                table: "patients");

            migrationBuilder.DropColumn(
                name: "copied_from_patient_id",
                table: "patients");
        }
    }
}
