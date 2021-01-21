import joi from 'joi'

export as namespace ut
interface meta {
    method?: string,
    forward?: object,
    httpResponse?: {
        type?: string,
        redirect?: string,
        state?: any[],
        header?: string[]
    },
    httpRequest?: {
        url: URL,
        headers: object
    },
    auth: {
        mlek: object,
        mlsk: object,
        permissionMap: Buffer,
        actorId: string | number,
        sessionId: string
    },
    conId: number,
    destination: string
}

export type error = (message?: string | { params: object }) => Error
interface errorMap {
    [name: string]: error
}

export type remoteHandler<request, response> = (params: request, $meta?: meta) => Promise<response>
export type portHandler<request, response> = (this: port, params: request, $meta?: meta) => Promise<response> | Error | response

type fn = (...params: any[]) => any
type logger = (message: string | object) => void
type errorLogger = (error: Error) => void

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
    errors: errorMap,
    request: fn,
    publish: fn,
    drain: fn,
    isDebug: () => boolean,
    getConversion: () => ($meta: meta, type: string) => portHandler<any, any>,
    merge: (...params: object[]) => object,
    [name: string]: any
}

interface key {
    id: string,
    segment?: string,
    params?: object
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
    utMeta: (params?: object) => meta,
    utNotify: (methodName: string) => remoteHandler<any, any>,
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
    version: (version: string) => boolean,
    utBus: {
        config: {
            workDir: string
        },
        info: () => {
            encrypt: object,
            sign: object,
            uri: string,
            port: number | string,
            host: string,
            address: undefined | string,
            protocol: 'http' | 'https' | 'socket'
        }
    }
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
    /**
     * partial schema
     */
    lib: {
        [name: string]: joi.Schema
    },
    /**
     * module configuration map
     */
    config: {
        [name: string]: any
    }
}

type validationSetting = joi.Schema | boolean
type auth = boolean | 'preauthorized' | 'exchange'

export type validationFactory = (api: validation) => {
    [name: string]: () => {
        description?: string,
        auth?: auth,
        params: joi.Schema,
        result: joi.Schema
    } | {
        description?: string,
        auth?: auth,
        method: 'GET' | 'PUT' | 'POST' | 'DELETE',
        path: string,
        cors?: object,
        validate?: {
            params?: validationSetting,
            query?: validationSetting,
            payload?: validationSetting,
            headers?: validationSetting,
            state?: validationSetting
        },
        /**
         * @deprecated
         */
        isRpc?: boolean
    }
}

export type validationLib = (api: validation) => {
    [name: string]: joi.Schema
}
type validationOrLib = validationFactory | validationLib

export type validationSet = () => validationOrLib[]
export type handlerSet<methods, errors> = (api: api<errors>) => handlerOrLib<methods, errors>[]
