using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class NormalizeFieldTimestampLedgers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE patients SET field_timestamps = '{}'::jsonb " +
                "WHERE jsonb_typeof(field_timestamps) IS DISTINCT FROM 'object';");
            migrationBuilder.Sql(
                "UPDATE ambulanzprotokoll_page1s SET field_timestamps = '{}'::jsonb " +
                "WHERE jsonb_typeof(field_timestamps) IS DISTINCT FROM 'object';");

            migrationBuilder.AlterColumn<string>(
                name: "field_timestamps",
                table: "patients",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}",
                oldClrType: typeof(string),
                oldType: "jsonb");

            migrationBuilder.AlterColumn<string>(
                name: "field_timestamps",
                table: "ambulanzprotokoll_page1s",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}",
                oldClrType: typeof(string),
                oldType: "jsonb");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "field_timestamps",
                table: "patients",
                type: "jsonb",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "jsonb",
                oldDefaultValue: "{}");

            migrationBuilder.AlterColumn<string>(
                name: "field_timestamps",
                table: "ambulanzprotokoll_page1s",
                type: "jsonb",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "jsonb",
                oldDefaultValue: "{}");
        }
    }
}
