import type { Topics, ZwaveApiName } from './topics.ts'

/** How long an API call waits for zwave-js-ui before giving up, by default. */
export const DEFAULT_API_TIMEOUT_MS = 20_000

export interface ZwaveApiOptions {
  readonly topics: () => Topics
  /** Returns false when the message could not be sent (broker down). */
  readonly publish: (topic: string, payload: string) => boolean
  /** Injectable for the tests. */
  readonly setTimeout?: typeof setTimeout
  readonly clearTimeout?: typeof clearTimeout
}

interface Pending {
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/** Answer zwave-js-ui publishes on `.../api/<name>`. */
interface ApiResponse {
  success?: boolean
  message?: string
  result?: unknown
  /** The request payload, echoed verbatim — which is what carries our id back. */
  origin?: { requestId?: unknown }
}

/**
 * Request / response over the zwave-js-ui MQTT API.
 *
 * zwave-js-ui answers a call on the request topic minus `/set`, and copies the
 * whole request payload into the answer's `origin` field (`Gateway.ts`,
 * `_onApiRequest`). Extra keys of the request are ignored by the API but come
 * back in `origin`, so each call carries a `requestId` and is matched on it:
 * two scenes pinging two nodes at once must not swap their answers, and an
 * answer to another client of the same broker must not resolve ours.
 */
export class ZwaveApi {
  private readonly options: ZwaveApiOptions
  private readonly pending = new Map<string, Pending>()
  private sequence = 0

  constructor(options: ZwaveApiOptions) {
    this.options = options
  }

  /**
   * Call `api` with positional `args` and resolve with its `result`. Rejects
   * when zwave-js-ui reports a failure, when the broker is down, or after
   * `timeoutMs` without an answer — zwave-js-ui not running, or set up with
   * another gateway name, never answers at all.
   */
  call(
    api: ZwaveApiName,
    args: readonly unknown[],
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
  ): Promise<unknown> {
    const requestId = `gladys-${Date.now().toString(36)}-${(this.sequence += 1)}`
    const set = this.options.setTimeout ?? setTimeout
    return new Promise((resolve, reject) => {
      const timer = set(() => {
        this.pending.delete(requestId)
        reject(
          new Error(`Z-Wave JS UI did not answer ${api} within ${Math.round(timeoutMs / 1000)} s`),
        )
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(requestId, { resolve, reject, timer })

      const sent = this.options.publish(
        this.options.topics().apiRequest(api),
        JSON.stringify({ args, requestId }),
      )
      if (!sent) {
        this.settle(requestId)?.reject(new Error('The MQTT broker is not connected'))
      }
    })
  }

  /**
   * Hand over an MQTT message. Returns true when it was the answer to one of
   * our calls — consumed, nothing else to do with it.
   */
  handle(payload: unknown): boolean {
    const response = payload as ApiResponse | null
    const requestId = response?.origin?.requestId
    if (typeof requestId !== 'string') {
      return false
    }
    const pending = this.settle(requestId)
    if (!pending) {
      return false
    }
    if (response?.success === true) {
      pending.resolve(response.result)
    } else {
      pending.reject(new Error(response?.message || 'Z-Wave JS UI refused the request'))
    }
    return true
  }

  /** Fail every call still waiting: the link they were sent on is gone. */
  rejectAll(reason: string): void {
    // Deleting the current entry while iterating a Map is safe in JS.
    for (const requestId of this.pending.keys()) {
      this.settle(requestId)?.reject(new Error(reason))
    }
  }

  private settle(requestId: string): Pending | undefined {
    const pending = this.pending.get(requestId)
    if (pending) {
      this.pending.delete(requestId)
      ;(this.options.clearTimeout ?? clearTimeout)(pending.timer)
    }
    return pending
  }
}
