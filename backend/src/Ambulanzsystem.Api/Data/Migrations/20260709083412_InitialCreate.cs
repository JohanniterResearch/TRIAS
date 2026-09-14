using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audit_logs",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    actor_id = table.Column<int>(type: "integer", nullable: true),
                    actor_role = table.Column<string>(type: "text", nullable: false),
                    action = table.Column<string>(type: "text", nullable: false),
                    entity_type = table.Column<string>(type: "text", nullable: false),
                    entity_id = table.Column<int>(type: "integer", nullable: true),
                    patient_id = table.Column<int>(type: "integer", nullable: true),
                    changed_fields = table.Column<string>(type: "jsonb", nullable: true),
                    before = table.Column<string>(type: "jsonb", nullable: true),
                    after = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_logs", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "organisations",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organisations", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "operation_scenes",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    organisation_id = table.Column<int>(type: "integer", nullable: true),
                    parent_scene_id = table.Column<int>(type: "integer", nullable: true),
                    access_window_start = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    access_window_end = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_operation_scenes", x => x.id);
                    table.ForeignKey(
                        name: "fk_operation_scenes_operation_scenes_parent_scene_id",
                        column: x => x.parent_scene_id,
                        principalTable: "operation_scenes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_operation_scenes_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "qr_code_logins",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    qr_token = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    event_scene_id = table.Column<int>(type: "integer", nullable: false),
                    first_login = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    expires_in_hours = table.Column<double>(type: "double precision", nullable: false),
                    revoked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_qr_code_logins", x => x.id);
                    table.ForeignKey(
                        name: "fk_qr_code_logins_operation_scenes_event_scene_id",
                        column: x => x.event_scene_id,
                        principalTable: "operation_scenes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    username = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: false),
                    role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    account_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    event_scene_id = table.Column<int>(type: "integer", nullable: true),
                    requires_password_change = table.Column<bool>(type: "boolean", nullable: false),
                    security_stamp = table.Column<string>(type: "text", nullable: false),
                    first_login_time = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_login_time = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_by = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                    table.ForeignKey(
                        name: "fk_users_operation_scenes_event_scene_id",
                        column: x => x.event_scene_id,
                        principalTable: "operation_scenes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "patients",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    atmung = table.Column<bool>(type: "boolean", nullable: true),
                    blutung = table.Column<bool>(type: "boolean", nullable: true),
                    radialispuls = table.Column<bool>(type: "boolean", nullable: true),
                    transport = table.Column<bool>(type: "boolean", nullable: true),
                    dringend = table.Column<bool>(type: "boolean", nullable: true),
                    kontaminiert = table.Column<bool>(type: "boolean", nullable: true),
                    triagefarbe = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    name = table.Column<string>(type: "text", nullable: true),
                    human_readable_id = table.Column<string>(type: "text", nullable: true),
                    client_generated_id = table.Column<Guid>(type: "uuid", nullable: true),
                    longitude_patient = table.Column<double>(type: "double precision", nullable: true),
                    latitude_patient = table.Column<double>(type: "double precision", nullable: true),
                    location_source = table.Column<string>(type: "text", nullable: true),
                    location_accuracy_meters = table.Column<double>(type: "double precision", nullable: true),
                    indoor_location = table.Column<string>(type: "text", nullable: true),
                    location_updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    operation_scene_id = table.Column<int>(type: "integer", nullable: false),
                    user_id_user = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_patients", x => x.id);
                    table.CheckConstraint("ck_patients_triagefarbe", "triagefarbe IN ('rot','gelb','gruen','schwarz')");
                    table.ForeignKey(
                        name: "fk_patients_operation_scenes_operation_scene_id",
                        column: x => x.operation_scene_id,
                        principalTable: "operation_scenes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_patients_users_user_id_user",
                        column: x => x.user_id_user,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "refresh_tokens",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    is_revoked = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_refresh_tokens", x => x.id);
                    table.ForeignKey(
                        name: "fk_refresh_tokens_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ambulanzprotokoll_page1s",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    patient_id = table.Column<int>(type: "integer", nullable: false),
                    form_state = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    finalized_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ambulanzprotokoll_page1s", x => x.id);
                    table.ForeignKey(
                        name: "fk_ambulanzprotokoll_page1s_patients_patient_id",
                        column: x => x.patient_id,
                        principalTable: "patients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "bodies",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    patient_id = table.Column<int>(type: "integer", nullable: false),
                    body_parts = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bodies", x => x.id);
                    table.ForeignKey(
                        name: "fk_bodies_patients_patient_id",
                        column: x => x.patient_id,
                        principalTable: "patients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "qr_code_patients",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    qr_token = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    patient_id = table.Column<int>(type: "integer", nullable: true),
                    user_id = table.Column<int>(type: "integer", nullable: true),
                    operation_scene_id = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_qr_code_patients", x => x.id);
                    table.ForeignKey(
                        name: "fk_qr_code_patients_operation_scenes_operation_scene_id",
                        column: x => x.operation_scene_id,
                        principalTable: "operation_scenes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_qr_code_patients_patients_patient_id",
                        column: x => x.patient_id,
                        principalTable: "patients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_qr_code_patients_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "teams",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "text", nullable: false),
                    operation_scene_id = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "text", nullable: true),
                    assigned_patient_id = table.Column<int>(type: "integer", nullable: true),
                    assigned_location = table.Column<string>(type: "text", nullable: true),
                    contact_info = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_teams", x => x.id);
                    table.ForeignKey(
                        name: "fk_teams_operation_scenes_operation_scene_id",
                        column: x => x.operation_scene_id,
                        principalTable: "operation_scenes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_teams_patients_assigned_patient_id",
                        column: x => x.assigned_patient_id,
                        principalTable: "patients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ambulanzprotokoll_page1s_patient_id",
                table: "ambulanzprotokoll_page1s",
                column: "patient_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_audit_logs_patient_id",
                table: "audit_logs",
                column: "patient_id");

            migrationBuilder.CreateIndex(
                name: "ix_audit_logs_timestamp",
                table: "audit_logs",
                column: "timestamp");

            migrationBuilder.CreateIndex(
                name: "ix_bodies_patient_id",
                table: "bodies",
                column: "patient_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_operation_scenes_organisation_id",
                table: "operation_scenes",
                column: "organisation_id");

            migrationBuilder.CreateIndex(
                name: "ix_operation_scenes_parent_scene_id",
                table: "operation_scenes",
                column: "parent_scene_id");

            migrationBuilder.CreateIndex(
                name: "ix_patients_client_generated_id",
                table: "patients",
                column: "client_generated_id",
                unique: true,
                filter: "client_generated_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_patients_operation_scene_id",
                table: "patients",
                column: "operation_scene_id");

            migrationBuilder.CreateIndex(
                name: "ix_patients_user_id_user",
                table: "patients",
                column: "user_id_user");

            migrationBuilder.CreateIndex(
                name: "ix_qr_code_logins_event_scene_id",
                table: "qr_code_logins",
                column: "event_scene_id");

            migrationBuilder.CreateIndex(
                name: "ix_qr_code_logins_qr_token",
                table: "qr_code_logins",
                column: "qr_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_qr_code_patients_operation_scene_id",
                table: "qr_code_patients",
                column: "operation_scene_id");

            migrationBuilder.CreateIndex(
                name: "ix_qr_code_patients_patient_id",
                table: "qr_code_patients",
                column: "patient_id",
                unique: true,
                filter: "patient_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_qr_code_patients_qr_token",
                table: "qr_code_patients",
                column: "qr_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_qr_code_patients_user_id",
                table: "qr_code_patients",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_token_hash",
                table: "refresh_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_user_id",
                table: "refresh_tokens",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_teams_assigned_patient_id",
                table: "teams",
                column: "assigned_patient_id");

            migrationBuilder.CreateIndex(
                name: "ix_teams_operation_scene_id",
                table: "teams",
                column: "operation_scene_id");

            migrationBuilder.CreateIndex(
                name: "ix_users_event_scene_id",
                table: "users",
                column: "event_scene_id");

            migrationBuilder.CreateIndex(
                name: "ix_users_username",
                table: "users",
                column: "username",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ambulanzprotokoll_page1s");

            migrationBuilder.DropTable(
                name: "audit_logs");

            migrationBuilder.DropTable(
                name: "bodies");

            migrationBuilder.DropTable(
                name: "qr_code_logins");

            migrationBuilder.DropTable(
                name: "qr_code_patients");

            migrationBuilder.DropTable(
                name: "refresh_tokens");

            migrationBuilder.DropTable(
                name: "teams");

            migrationBuilder.DropTable(
                name: "patients");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "operation_scenes");

            migrationBuilder.DropTable(
                name: "organisations");
        }
    }
}
