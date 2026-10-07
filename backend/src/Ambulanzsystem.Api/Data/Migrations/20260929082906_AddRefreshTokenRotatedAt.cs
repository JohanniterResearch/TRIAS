using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRefreshTokenRotatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "rotated_at",
                table: "refresh_tokens",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "rotated_at",
                table: "refresh_tokens");
        }
    }
}
