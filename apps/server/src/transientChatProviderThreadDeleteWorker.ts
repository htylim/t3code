import { runTransientChatDeletionWorker } from "./transientChatDeletionWorker.ts";

await runTransientChatDeletionWorker(process.argv.slice(2));
