// Handler registry — maps handler type strings to handler instances

import { Handler, GraphNode, SHAPE_TO_TYPE } from '../types.js'
import { StartHandler } from './start.js'
import { ExitHandler } from './exit.js'
import { CodergenHandler } from './codergen.js'
import { ConditionalHandler } from './conditional.js'
import { WaitForHumanHandler } from './human.js'
import { ToolHandler } from './tool.js'
import { ParallelHandler } from './parallel.js'
import { FanInHandler } from './fan_in.js'

export class HandlerRegistry {
  private handlers: Map<string, Handler> = new Map()
  private defaultHandler: Handler

  constructor() {
    this.defaultHandler = new CodergenHandler()

    // Register all built-in handlers
    this.register('start', new StartHandler())
    this.register('exit', new ExitHandler())
    this.register('codergen', new CodergenHandler())
    this.register('conditional', new ConditionalHandler())
    this.register('wait.human', new WaitForHumanHandler())
    this.register('tool', new ToolHandler())

    // Parallel execution handlers
    const parallelHandler = new ParallelHandler()
    parallelHandler.setRegistry(this)
    this.register('parallel', parallelHandler)

    const fanInHandler = new FanInHandler()
    fanInHandler.setCodergenHandler(this.defaultHandler)
    this.register('parallel.fan_in', fanInHandler)
  }

  register(typeString: string, handler: Handler): void {
    this.handlers.set(typeString, handler)
  }

  resolve(node: GraphNode): Handler {
    // 1. Explicit type attribute
    if (node.attrs.type && this.handlers.has(node.attrs.type)) {
      return this.handlers.get(node.attrs.type)!
    }

    // 2. Shape-based resolution
    const handlerType = SHAPE_TO_TYPE[node.attrs.shape]
    if (handlerType && this.handlers.has(handlerType)) {
      return this.handlers.get(handlerType)!
    }

    // 3. Default (codergen)
    return this.defaultHandler
  }

  /**
   * Check if a handler type is registered
   */
  hasHandler(typeString: string): boolean {
    return this.handlers.has(typeString)
  }
}
