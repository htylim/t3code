import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Old effect payloads cannot be decoded after the tag executor is removed.
  yield* sql`
    DELETE FROM orchestration_v2_effect_outbox
    WHERE effect_type = 'thread-tag.inherit'
  `;
});
