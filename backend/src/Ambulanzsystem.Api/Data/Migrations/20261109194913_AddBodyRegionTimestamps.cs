using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBodyRegionTimestamps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "region_timestamps_json",
                table: "bodies",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "region_timestamps_json",
                table: "bodies");
        }
    }
}
