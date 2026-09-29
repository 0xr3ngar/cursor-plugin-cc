// Stands in for the real cursor-agent in tests. It records what it was called with to the file in
// FAKE_CURSOR_RECORD. A prompt containing SLEEP keeps it running, and one containing FAIL makes it fail.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function emit(event: object) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

if (args[0] === "--version") {
  console.log("0.0.0-fake");
} else if (args[0] === "status") {
  console.log("✓ Logged in as test@example.com");
} else if (args[0] === "models") {
  process.stdout.write(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "models.txt")));
} else if (args[0] === "-p") {
  const prompt = fs.readFileSync(0, "utf8");
  fs.writeFileSync(process.env.FAKE_CURSOR_RECORD!, JSON.stringify({ args: args, prompt: prompt }));

  const sessionId = "fake-session-1";
  emit({ type: "system", subtype: "init", session_id: sessionId });
  if (prompt.includes("SLEEP")) {
    setInterval(() => {}, 1000);
  } else if (prompt.includes("FAIL")) {
    console.error("fake failure");
    process.exitCode = 1;
  } else {
    emit({ type: "tool_call", subtype: "started", session_id: sessionId });
    emit({ type: "assistant", message: { content: [{ type: "text", text: "Working on it." }] }, session_id: sessionId });
    emit({ type: "result", subtype: "success", is_error: false, result: "fake result", session_id: sessionId });
  }
} else {
  console.error("fake cursor-agent does not handle: " + args.join(" "));
  process.exitCode = 1;
}
