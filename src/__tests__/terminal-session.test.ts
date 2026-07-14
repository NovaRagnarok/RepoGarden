import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import type { FocusEventKind } from "../lib/focus";
import {
  BEGIN_SYNCED_UPDATE,
  END_SYNCED_UPDATE,
  ENTER_TERMINAL_SESSION,
  LEAVE_TERMINAL_SESSION,
  SIGNAL_EXIT_CODES,
  createTerminalSession,
  type HandledTerminalSignal,
  writeAllSynchronously,
} from "../lib/terminal-session";

class FakeProcess extends EventEmitter {
  readonly exitCodes: number[] = [];

  exit = (code = 0): never => {
    this.exitCodes.push(code);
    this.emit("exit", code);
    return undefined as never;
  };
}

class FakeStdout extends EventEmitter {
  isTTY = true;
  readonly chunks: string[] = [];
  readonly pendingCallbacks: Array<() => void> = [];
  deferCallbacks = false;
  throwOnTeardown = false;

  write = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (this.throwOnTeardown && text === LEAVE_TERMINAL_SESSION) {
      throw new Error("fixture teardown write failed");
    }
    this.chunks.push(text);
    const callback = args.find((arg): arg is () => void => typeof arg === "function");
    if (callback) {
      if (this.deferCallbacks) this.pendingCallbacks.push(callback);
      else callback();
    }
    return true;
  };

  flushCallbacks(): void {
    for (const callback of this.pendingCallbacks.splice(0)) callback();
  }
}

const makeFixture = ({
  synchronousTeardown = true,
}: { synchronousTeardown?: boolean } = {}) => {
  const runtimeProcess = new FakeProcess();
  const stdout = new FakeStdout();
  let focusListener: ((kind: FocusEventKind) => void) | undefined;
  let unsubscribeCount = 0;
  const originalWrite = stdout.write;
  const session = createTerminalSession({
    runtimeProcess: runtimeProcess as unknown as NodeJS.Process,
    stdout: stdout as unknown as NodeJS.WriteStream,
    subscribeToFocus: (listener) => {
      focusListener = listener;
      return () => {
        unsubscribeCount += 1;
        focusListener = undefined;
      };
    },
    writeTeardownSynchronously: (text) => {
      if (!synchronousTeardown) return false;
      stdout.chunks.push(text);
      return true;
    },
  });
  return {
    runtimeProcess,
    stdout,
    session,
    originalWrite,
    focus: (kind: FocusEventKind) => focusListener?.(kind),
    unsubscribeCount: () => unsubscribeCount,
  };
};

const sessionListenerNames = [
  "exit",
  "SIGHUP",
  "SIGINT",
  "SIGQUIT",
  "SIGTERM",
  "uncaughtException",
] as const;

test("terminal session wraps frames and disposes directly exactly once", () => {
  const fixture = makeFixture();

  assert.notEqual(fixture.stdout.write, fixture.originalWrite);
  assert.deepEqual(fixture.stdout.chunks, [ENTER_TERMINAL_SESSION]);
  for (const event of sessionListenerNames) {
    assert.equal(fixture.runtimeProcess.listenerCount(event), 1, event);
  }

  let callbackCalled = false;
  fixture.stdout.write("frame", () => {
    callbackCalled = true;
  });
  assert.equal(callbackCalled, true);
  assert.equal(
    fixture.stdout.chunks.at(-1),
    BEGIN_SYNCED_UPDATE + "frame" + END_SYNCED_UPDATE
  );

  fixture.focus("focus-in");
  assert.equal(fixture.stdout.chunks.at(-1), END_SYNCED_UPDATE);

  fixture.session.dispose();
  fixture.session.dispose();

  assert.equal(fixture.unsubscribeCount(), 1);
  assert.equal(fixture.stdout.write, fixture.originalWrite);
  assert.equal(
    fixture.stdout.chunks.filter((chunk) => chunk === LEAVE_TERMINAL_SESSION).length,
    1
  );
  const chunksAfterDispose = fixture.stdout.chunks.length;
  fixture.focus("focus-in");
  assert.equal(fixture.stdout.chunks.length, chunksAfterDispose);
  for (const event of sessionListenerNames) {
    assert.equal(fixture.runtimeProcess.listenerCount(event), 0, event);
  }

  fixture.stdout.write("plain");
  assert.equal(fixture.stdout.chunks.at(-1), "plain");
});

test("normal process exit disposes without changing the exit status", () => {
  const fixture = makeFixture();

  fixture.runtimeProcess.emit("exit", 0);

  assert.deepEqual(fixture.runtimeProcess.exitCodes, []);
  assert.equal(fixture.stdout.write, fixture.originalWrite);
  assert.equal(fixture.unsubscribeCount(), 1);
  assert.equal(
    fixture.stdout.chunks.filter((chunk) => chunk === LEAVE_TERMINAL_SESSION).length,
    1
  );
});

test("repeated signals stay guarded until one asynchronous teardown completes", () => {
  const fixture = makeFixture({ synchronousTeardown: false });
  fixture.stdout.deferCallbacks = true;

  fixture.runtimeProcess.emit("SIGINT");
  fixture.runtimeProcess.emit("SIGINT");
  fixture.runtimeProcess.emit("SIGTERM");

  assert.deepEqual(fixture.runtimeProcess.exitCodes, []);
  assert.equal(fixture.stdout.pendingCallbacks.length, 1);
  assert.equal(fixture.stdout.write, fixture.originalWrite);
  assert.equal(fixture.runtimeProcess.listenerCount("SIGINT"), 1);
  assert.equal(fixture.runtimeProcess.listenerCount("SIGTERM"), 1);
  fixture.stdout.flushCallbacks();
  assert.deepEqual(fixture.runtimeProcess.exitCodes, [130]);
  assert.equal(
    fixture.stdout.chunks.filter((chunk) => chunk === LEAVE_TERMINAL_SESSION).length,
    1
  );
  for (const event of sessionListenerNames) {
    assert.equal(fixture.runtimeProcess.listenerCount(event), 0, event);
  }
});

test("synchronous teardown loops until a short-writing fd accepts every byte", () => {
  const chunks: Buffer[] = [];
  let calls = 0;

  writeAllSynchronously(17, LEAVE_TERMINAL_SESSION, (fd, buffer, offset, length) => {
    assert.equal(fd, 17);
    calls += 1;
    const written = Math.min(3, length);
    chunks.push(Buffer.from(buffer.slice(offset, offset + written)));
    return written;
  });

  assert.ok(calls > 1);
  assert.equal(Buffer.concat(chunks).toString("utf8"), LEAVE_TERMINAL_SESSION);
});

for (const [signal, expectedCode] of Object.entries(SIGNAL_EXIT_CODES) as Array<
  [HandledTerminalSignal, number]
>) {
  test(`${signal} restores the terminal and exits with status ${expectedCode}`, () => {
    const fixture = makeFixture();

    fixture.runtimeProcess.emit(signal);

    assert.deepEqual(fixture.runtimeProcess.exitCodes, [expectedCode]);
    assert.equal(fixture.stdout.write, fixture.originalWrite);
    assert.equal(fixture.unsubscribeCount(), 1);
    assert.equal(
      fixture.stdout.chunks.filter((chunk) => chunk === LEAVE_TERMINAL_SESSION).length,
      1
    );
    for (const event of sessionListenerNames) {
      assert.equal(fixture.runtimeProcess.listenerCount(event), 0, event);
    }
  });
}

test("uncaught exceptions restore once, report the error, and exit nonzero", () => {
  const runtimeProcess = new FakeProcess();
  const stdout = new FakeStdout();
  const errors: unknown[] = [];
  let unsubscribeCount = 0;
  const originalWrite = stdout.write;
  createTerminalSession({
    runtimeProcess: runtimeProcess as unknown as NodeJS.Process,
    stdout: stdout as unknown as NodeJS.WriteStream,
    subscribeToFocus: () => () => {
      unsubscribeCount += 1;
    },
    reportError: (error) => errors.push(error),
    writeTeardownSynchronously: (text) => {
      stdout.chunks.push(text);
      return true;
    },
  });
  const error = new Error("fixture failure");

  runtimeProcess.emit("uncaughtException", error);

  assert.deepEqual(errors, [error]);
  assert.deepEqual(runtimeProcess.exitCodes, [1]);
  assert.equal(stdout.write, originalWrite);
  assert.equal(unsubscribeCount, 1);
  assert.equal(
    stdout.chunks.filter((chunk) => chunk === LEAVE_TERMINAL_SESSION).length,
    1
  );
});

test("cleanup failures stay best-effort and cannot suppress signal status", () => {
  class ThrowingOffProcess extends FakeProcess {
    readonly offAttempts: string[] = [];

    override off(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
      this.offAttempts.push(String(eventName));
      if (eventName === "SIGHUP") throw new Error("fixture off failed");
      return super.off(eventName, listener);
    }
  }

  const runtimeProcess = new ThrowingOffProcess();
  const stdout = new FakeStdout();
  stdout.throwOnTeardown = true;
  const originalWrite = stdout.write;
  let unsubscribeAttempts = 0;
  createTerminalSession({
    runtimeProcess: runtimeProcess as unknown as NodeJS.Process,
    stdout: stdout as unknown as NodeJS.WriteStream,
    subscribeToFocus: () => () => {
      unsubscribeAttempts += 1;
      throw new Error("fixture unsubscribe failed");
    },
    writeTeardownSynchronously: () => {
      throw new Error("fixture sync write failed");
    },
  });

  runtimeProcess.emit("SIGTERM");

  assert.equal(unsubscribeAttempts, 1);
  assert.deepEqual(runtimeProcess.exitCodes, [143]);
  assert.equal(stdout.write, originalWrite);
  for (const event of sessionListenerNames) {
    assert.ok(runtimeProcess.offAttempts.includes(event), event);
  }
});

test("non-TTY output leaves streams and process listeners untouched", () => {
  const runtimeProcess = new FakeProcess();
  const stdout = new FakeStdout();
  stdout.isTTY = false;
  const originalWrite = stdout.write;
  let subscribed = false;

  const session = createTerminalSession({
    runtimeProcess: runtimeProcess as unknown as NodeJS.Process,
    stdout: stdout as unknown as NodeJS.WriteStream,
    subscribeToFocus: () => {
      subscribed = true;
      return () => undefined;
    },
    writeTeardownSynchronously: () => {
      assert.fail("non-TTY setup must not install a teardown writer");
    },
  });
  session.dispose();

  assert.equal(subscribed, false);
  assert.equal(stdout.write, originalWrite);
  assert.deepEqual(stdout.chunks, []);
  for (const event of sessionListenerNames) {
    assert.equal(runtimeProcess.listenerCount(event), 0, event);
  }
});
