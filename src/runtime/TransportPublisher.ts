import type { DeviceTransportEntry, Logger } from '@gladysassistant/integration-sdk'

/** Hard limit of the Gladys host API (spec C.3). */
const MAX_ENTRIES_PER_REQUEST = 100

/** Delay before re-sending what Gladys refused. */
const RETRY_DELAY_MS = 5000

export interface TransportPublisherOptions {
  readonly logger: Logger
  /** Sends one batch; must reject on failure so the entries are retried. */
  readonly publish: (entries: DeviceTransportEntry[]) => Promise<unknown>
  /** External ids of the devices the user actually created. */
  readonly knownDevices: () => ReadonlySet<string>
  /** Injectable, so the tests do not have to wait for the retry. */
  readonly retryDelayMs?: number
}

/** Everything the badge shows: two entries with the same key look the same. */
function keyOf(entry: DeviceTransportEntry): string {
  return JSON.stringify([entry.transport, entry.degraded === true, entry.message?.en])
}

/**
 * Publishes the per-device transport badge, changes only.
 *
 * The badge is fed from every node report, so most entries repeat what Gladys
 * already shows; sending them anyway would turn each value update into a
 * request.
 *
 * What waits is the LATEST entry of each device, not a log of them: a node
 * going dead then alive while a request is in flight ends up alive, never in
 * the reverse order. A refused entry stays there and is retried on a timer —
 * not "by the next report", because the entry that matters most, a dead node,
 * is precisely the one that never reports again.
 */
export class TransportPublisher {
  private readonly options: TransportPublisherOptions
  private readonly pending = new Map<string, DeviceTransportEntry>()
  private readonly published = new Map<string, string>()
  /**
   * Bumped by every `forget`. A request that was in flight when the memory was
   * cleared — typically a Gladys reconnection — must not write its entries back
   * as if the NEW session had received them.
   */
  private generation = 0
  private queue: Promise<void> = Promise.resolve()
  private retryTimer: NodeJS.Timeout | undefined
  private stopped = false

  constructor(options: TransportPublisherOptions) {
    this.options = options
  }

  push(entries: readonly DeviceTransportEntry[]): void {
    if (this.stopped || entries.length === 0) {
      return
    }
    for (const entry of entries) {
      this.pending.set(entry.external_id, entry)
    }
    this.flush()
  }

  /** Forget one device, or everything: its next entry goes through whatever it says. */
  forget(deviceExternalId?: string): void {
    this.generation += 1
    if (deviceExternalId === undefined) {
      this.published.clear()
      this.pending.clear()
    } else {
      this.published.delete(deviceExternalId)
      this.pending.delete(deviceExternalId)
    }
  }

  /**
   * Send what is still pending, then refuse anything new: the Gladys socket is
   * going away, and an entry pushed now could only fail and warn.
   */
  async stop(): Promise<void> {
    this.stopped = true
    this.clearRetry()
    await this.queue
  }

  /** Revive a stopped publisher, with a blank memory: Gladys may have lost it. */
  reset(): void {
    this.forget()
    this.stopped = false
  }

  /** Resolves once every entry pushed so far has been sent, or given up on. */
  idle(): Promise<void> {
    return this.queue
  }

  private flush(): void {
    this.queue = this.queue.then(() => this.send())
  }

  private async send(): Promise<void> {
    // Unknown devices are dropped, not sent: the badge lives in a param of the
    // Gladys device, and a device the user never created has nowhere to keep it.
    const known = this.options.knownDevices()
    const changed: DeviceTransportEntry[] = []
    for (const [externalId, entry] of this.pending) {
      if (known.has(externalId) && this.published.get(externalId) !== keyOf(entry)) {
        changed.push(entry)
      } else {
        this.pending.delete(externalId)
      }
    }

    let failed = false
    for (let start = 0; start < changed.length; start += MAX_ENTRIES_PER_REQUEST) {
      const batch = changed.slice(start, start + MAX_ENTRIES_PER_REQUEST)
      const generation = this.generation
      try {
        // oxlint-disable-next-line no-await-in-loop
        await this.options.publish(batch)
      } catch (error) {
        failed = true
        this.options.logger.warn('Failed to publish the device transports', error)
        continue
      }
      if (generation !== this.generation) {
        continue
      }
      for (const entry of batch) {
        this.published.set(entry.external_id, keyOf(entry))
        // Only if nothing newer arrived during the request.
        if (this.pending.get(entry.external_id) === entry) {
          this.pending.delete(entry.external_id)
        }
      }
    }

    if (failed) {
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.stopped) {
      return
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      if (!this.stopped) {
        this.flush()
      }
    }, this.options.retryDelayMs ?? RETRY_DELAY_MS)
    this.retryTimer.unref?.()
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }
}
