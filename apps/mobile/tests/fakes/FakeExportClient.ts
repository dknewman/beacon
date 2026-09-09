import type { ExportClient } from '../../src/native/ExportClient';

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface WrittenFile {
  fileName: string;
  contents: string;
}

export interface ShareCall {
  path: string;
  mimeType: string;
}

/**
 * Deterministic stand-in for the export bridge. Every call stays pending until
 * the test resolves or rejects it, so the screen's preparing and sharing
 * states can be asserted rather than raced.
 */
export class FakeExportClient implements ExportClient {
  readonly written: WrittenFile[] = [];
  readonly shares: ShareCall[] = [];
  clearCalls = 0;

  private readonly pendingWrites: Deferred<string>[] = [];
  private readonly pendingShares: Deferred<boolean>[] = [];

  writeTemporaryFile(fileName: string, contents: string): Promise<string> {
    this.written.push({ fileName, contents });
    return new Promise<string>((resolve, reject) => {
      this.pendingWrites.push({ resolve, reject });
    });
  }

  shareFile(path: string, mimeType: string): Promise<boolean> {
    this.shares.push({ path, mimeType });
    return new Promise<boolean>((resolve, reject) => {
      this.pendingShares.push({ resolve, reject });
    });
  }

  clearTemporaryFiles(): Promise<number> {
    this.clearCalls += 1;
    return Promise.resolve(0);
  }

  /** Resolves the oldest pending write with a path derived from the file name. */
  resolveWrite(path?: string): void {
    const pending = this.take(this.pendingWrites, 'write');
    const fallback = this.written[this.written.length - this.pendingWrites.length - 1];
    pending.resolve(path ?? `/tmp/beacon-export/${fallback?.fileName ?? 'file'}`);
  }

  rejectWrite(error: unknown): void {
    this.take(this.pendingWrites, 'write').reject(error);
  }

  /** Resolves the oldest pending share; `shared` false models a dismissal. */
  resolveShare(shared = true): void {
    this.take(this.pendingShares, 'share').resolve(shared);
  }

  rejectShare(error: unknown): void {
    this.take(this.pendingShares, 'share').reject(error);
  }

  get lastWritten(): WrittenFile | undefined {
    return this.written[this.written.length - 1];
  }

  private take<T>(queue: Deferred<T>[], label: string): Deferred<T> {
    const pending = queue.shift();
    if (pending === undefined) {
      throw new Error(`No pending ${label} call to settle`);
    }
    return pending;
  }
}
