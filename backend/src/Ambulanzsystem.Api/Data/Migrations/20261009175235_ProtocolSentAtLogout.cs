using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ProtocolSentAtLogout : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "sent_at_logout_at",
                table: "ambulanzprotokoll_page1s",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "sent_at_logout_at",
                table: "ambulanzprotokoll_page1s");
        }
    }
}
