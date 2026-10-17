import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("063_RemoveThreadTagEffects", (it) => {
  it.effect("removes obsolete tag effects in every state and preserves provider work", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 62 });
      const timestamp = "2026-10-17T00:00:00.000Z";
      for (const status of ["pending", "running", "succeeded", "failed", "cancelled"]) {
        yield* sql`INSERT INTO orchestration_v2_effect_outbox ${sql.insert({
          effect_id: `tag-${status}`,
          command_id: "command",
          thread_id: "thread",
          effect_type: "thread-tag.inherit",
          payload_json: '{"type":"thread-tag.inherit","sourceThreadId":"parent"}',
          status,
          available_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        })}`;
      }
      yield* sql`INSERT INTO orchestration_v2_effect_outbox ${sql.insert({
        effect_id: "provider-work",
        command_id: "command",
        thread_id: "thread",
        effect_type: "provider-session.detach",
        payload_json: '{"type":"provider-session.detach","providerSessionId":"session"}',
        status: "pending",
        available_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      })}`;
      yield* runMigrations({ toMigrationInclusive: 63 });
      const remaining = yield* sql<{ readonly effect_id: string; readonly status: string }>`
        SELECT effect_id, status FROM orchestration_v2_effect_outbox
      `;
      assert.deepEqual(remaining, [{ effect_id: "provider-work", status: "pending" }]);
      assert.deepEqual(yield* runMigrations({ toMigrationInclusive: 63 }), []);
    }),
  );
});
