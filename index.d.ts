import joi from 'joi'

export as namespace ut

interface meta {
    method?: string,
    forward?: object
}

export type remoteHandler<request, response> = (params: request, $meta?: meta) => Promise<response>
export type portHandler<request, response> = (this: port, params: request, $meta?: meta) => Promise<response> | Error

type fn = (...params: any[]) => any;
type logger = (message: string | object) => void;
type errorLogger = (error: Error) => void;

interface port {
    findHandler: (name: string) => portHandler<any, any>,
    includesConfig: (name: string, values: any, defaultValue: boolean) => boolean,
    validator: (schema: joi.Schema, method: string, type: 'params' | 'result') => ((value: any) => any),
    error: (error: Error, $meta: meta) => void,
    fatal: (error: Error) => void,
    start: () => Promise<object>,
    stop: () => Promise<boolean>,
    log: {
        trace?: logger,
        debug?: logger,
        info?: logger,
        error?: errorLogger,
        warn?: errorLogger,
        fatal?: errorLogger
    },
    request: fn,
    publish: fn,
    drain: fn,
    isDebug: () => boolean,
    getConversion: () => ($meta: meta, type: string) => portHandler<any, any>,
    merge: (...params: object[]) => object
}

interface key {
    id: string,
    segment?: string,
    params?: object
}

export type error = ((message: string) => Error) | (({ params: object }) => Error)
interface errorMap {
    [name: string]: error
}

type api<imports> = {
    joi: joi.Root,
    /**
     * Return a function, which calls a remote handler
     * @param methodName The remote method name
     */
    utMethod: (methodName: string, options?: {
        timeout?: number,
        /**
         * Cache configuration for remote call
         * @see [ut-port-cache](https://github.com/softwaregroup-bg/ut-port-cache)
         */
        cache?: {
            key: key | ((params: any) => key),
            segment?: string,
            ttl?: number,
            port?: string,
            optional?: boolean,
            before?: 'get' | 'drop' | false,
            after?: 'set' | 'testAndSet' | 'touch' | false
        },
        fallback?: fn,
        returnMeta?: boolean
    }) => remoteHandler<any, any>,
    /**
     * import remote handlers
     */
    import: imports,
    lib: {
        [name: string]: any
    },
    /**
     * module configuration map
     */
    config: {
        [name: string]: any
    },
    utError: {
        defineError: (id: string, superType: string, message: string) => error,
        getError: (() => errorMap) | ((type: string) => error),
        fetchErrors: (type:string) => errorMap } & {
        readonly [name: string]: error
    },
    version: (version: string) => boolean
}

export type handlers<imports> = (api: api<imports>) => {
    [name: string]: portHandler<any, any>
}

type handlerOrError = remoteHandler<any, any> & error

interface genericHandlers {
    [name: string]: handlerOrError
}

type lib<imports> = (api: api<imports>) => {
    [name: string]: any
}

export type handlerFactory<methods, errors> = handlers<methods & errors & genericHandlers>
export type libFactory<methods, errors> = lib<methods & errors & genericHandlers>
type handlerOrLib<methods, errors> = handlerFactory<methods, errors> | libFactory<methods, errors>

type validation = {
    joi: joi.Root,
    lib: {
        [name: string]: joi.Schema
    }
}

export type validationFactory = (api: validation) => {
    [name: string]: () => {
        description: string,
        params: joi.Schema,
        result: joi.Schema
    }
}

export type validationLib = (api: validation) => {
    [name: string]: joi.Schema
}
type validationOrLib = validationFactory | validationLib

export type validationSet = () => validationOrLib[]
export type handlerSet<methods, errors> = (api: api<errors>) => handlerOrLib<methods, errors>[]
