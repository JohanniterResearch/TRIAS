using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RestrictEventAccountDeletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_users_operation_scenes_event_scene_id",
                table: "users");

            migrationBuilder.AddForeignKey(
                name: "fk_users_operation_scenes_event_scene_id",
                table: "users",
                column: "event_scene_id",
                principalTable: "operation_scenes",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_users_operation_scenes_event_scene_id",
                table: "users");

            migrationBuilder.AddForeignKey(
                name: "fk_users_operation_scenes_event_scene_id",
                table: "users",
                column: "event_scene_id",
                principalTable: "operation_scenes",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
