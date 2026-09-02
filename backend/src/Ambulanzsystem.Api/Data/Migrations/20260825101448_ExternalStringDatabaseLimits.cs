using System.Text;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ambulanzsystem.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExternalStringDatabaseLimits : Migration
    {
        // Every column this migration narrows from `text` to a bounded varchar. Any legacy row
        // that doesn't fit must abort the migration with a diagnostic, not get silently
        // truncated or fail with a raw "value too long" error naming neither row nor remediation.
        private static readonly (string Table, string Column, int MaxLength)[] NarrowedColumns =
        {
            ("teams", "status", 32),
            ("teams", "name", 255),
            ("teams", "contact_info", 255),
            ("teams", "assigned_location", 255),
            ("patients", "name", 255),
            ("patients", "location_source", 255),
            ("patients", "indoor_location", 255),
            ("patients", "human_readable_id", 64),
            ("operation_scenes", "description", 2000),
        };

        // Aggregates every violation across all nine columns into a single abort instead of
        // failing on the first narrowed column found, so an operator gets one complete
        // remediation list rather than re-running the migration up to nine times.
        private static string BuildPreflightSql()
        {
            var sb = new StringBuilder();
            sb.AppendLine("DO $externalstringlimits_preflight$");
            sb.AppendLine("DECLARE");
            sb.AppendLine("    cnt integer;");
            sb.AppendLine("    ids text;");
            sb.AppendLine("    violations text := '';");
            sb.AppendLine("BEGIN");
            foreach (var (table, column, maxLength) in NarrowedColumns)
            {
                sb.AppendLine($@"
    SELECT count(*) INTO cnt FROM ""{table}"" WHERE {column} IS NOT NULL AND length({column}) > {maxLength};
    IF cnt > 0 THEN
        SELECT string_agg(id::text, ',' ORDER BY id) INTO ids
            FROM (SELECT id FROM ""{table}"" WHERE {column} IS NOT NULL AND length({column}) > {maxLength} ORDER BY id LIMIT 20) v;
        violations := violations || format(E'\n  {table}.{column}: %s row(s) exceed {maxLength} characters (row ids: %s%s; detection query: SELECT id FROM {table} WHERE length({column}) > {maxLength})',
            cnt, ids, CASE WHEN cnt > 20 THEN ', truncated to first 20' ELSE '' END);
    END IF;");
            }
            sb.AppendLine(@"
    IF violations <> '' THEN
        RAISE EXCEPTION E'ExternalStringDatabaseLimits migration preflight aborted -- legacy data exceeds the new column limits below. No automatic truncation was performed.%\nRemediation: shorten or archive the offending values, or obtain documented data-governance approval for an audited transformation together with a verified backup, then re-run migrations.', violations;
    END IF;
END
$externalstringlimits_preflight$;");
            return sb.ToString();
        }

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(BuildPreflightSql());

            migrationBuilder.AlterColumn<string>(
                name: "status",
                table: "teams",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "name",
                table: "teams",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "contact_info",
                table: "teams",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "assigned_location",
                table: "teams",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "name",
                table: "patients",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "location_source",
                table: "patients",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "indoor_location",
                table: "patients",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "human_readable_id",
                table: "patients",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "description",
                table: "operation_scenes",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "status",
                table: "teams",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "name",
                table: "teams",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            migrationBuilder.AlterColumn<string>(
                name: "contact_info",
                table: "teams",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "assigned_location",
                table: "teams",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "name",
                table: "patients",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "location_source",
                table: "patients",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "indoor_location",
                table: "patients",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "human_readable_id",
                table: "patients",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "description",
                table: "operation_scenes",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000,
                oldNullable: true);
        }
    }
}
