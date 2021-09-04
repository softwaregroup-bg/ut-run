import joi from 'joi'
import commonJoi from 'ut-function.common-joi';
import {readdir, readFileSync} from 'fs';
import {CallSiteLike} from 'stack-utils';

type hrtime = [number, number];

export as namespace ut
interface meta {
    mtid: 'request' | 'response' | 'error' | 'notification' | 'discard',
    method: string,
    opcode?: string,
    source?: string,
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
    language: {
        languageId: string | number
    },
    conId: number,
    destination?: string,
    dispatch?: (msg?: object, $meta?: meta) => [msg: object, $meta: meta] | boolean | Promise<boolean>,
    timeout: hrtime,
    timer?: (name?: string, newTime?: hrtime) => {
        [name: string]: number
    }
}

export type error = (message?: string | { params: object; cause?: error }) => Error
interface errorMap {
    [name: string]: error
}

interface context {
    session?: {
        [name: string]: any
    },
    conId?: string,
    requests: Map<string, {$meta: meta, end: (error: Error) => void}>,
    waiting: Set<(error: Error) => void>
}

export type remoteHandler<request, response> = (params: request, $meta: meta) => Promise<response>
export type portHandler<request, response> = (this: port, params: request, $meta: meta, context?: context) => Promise<response> | Error | response
export type handler<request, response, location> = location extends 'local' ? portHandler<request, response> : remoteHandler<request, response>

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
    timing: {
        diff: (time: hrtime, newTime: hrtime) => number,
        after: (number) => hrtime,
        isAfter: (time: hrtime, timeout: hrtime) => boolean
        now: () => hrtime
    },
    fireEvent(event: string, data: any, mapper?: 'asyncMap' | 'reduce'),
    [name: string]: any
}

interface key {
    id: string,
    segment?: string,
    params?: object
}

interface vfs {
    compile: () => boolean;
    readdir: typeof readdir;
    isFile: (fileName: string) => boolean;
    readFileSync: typeof readFileSync;
}

type api<imports> = {
    joi: joi.Root,
    /**
     * Return a function, which calls a remote handler
     * @param methodName The remote method name
     */
    utMethod: (methodName: string, options?: {
        timeout?: number,
        retry?: number,
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
    registerErrors: () => {
        [name: string]: string | {}
    },
    utError: {
        defineError: (id: string, superType: string, message: string) => error,
        getError: (() => errorMap) | ((type: string) => error),
        fetchErrors: (type:string) => errorMap } & {
        readonly [name: string]: error
    },
    version: (version: string) => boolean,
    vfs: vfs,
    callSite: () => CallSiteLike,
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

interface genericExport {
    [name: string]: portHandler<any, any>
}

interface eventHandlers {
    start?: (this: port) => Promise<any>,
    ready?: (this: port) => Promise<any>,
    stop?: (this: port) => Promise<any>,
    send?: portHandler<any, any>,
    receive?: portHandler<any, any>,
    'error.receive'?: portHandler<any, any>,
}

export type handlers<imports, exports = genericExport> = (api: api<imports>) => exports & eventHandlers

type handlerOrError = remoteHandler<any, any> & error

interface genericErrors {
    [name: `error${string}`]: error;
}
export interface genericHandlers {
    [name: string]: remoteHandler<any, any>;
}

type lib<imports> = (api: api<imports>) => {
    [name: string]: any
}

export type handlerFactory<methods, errors, exports> = handlers<methods & errors & genericErrors & genericHandlers, exports>
export type libFactory<methods, errors> = lib<methods & errors & genericHandlers>
type handlerOrLib<methods, errors, exports> = handlerFactory<methods, errors, exports> | libFactory<methods, errors>

type validation = {
    joi: joi.Root,
    /**
     * partial schema
     */
    lib: ReturnType<typeof commonJoi> & {
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
type timeout = {
    server?: number | boolean,
    socket?: number | boolean
}
type cors = {
    origin?: string[],
    maxAge?: number,
    headers?: string[],
    additionalHeaders?: string[],
    exposedHeaders?: string[],
    additionalExposedHeaders?: string[],
    credentials?: boolean
}

type security = {
    hsts?: true | number | {
        maxAge: number;
        includeSubDomains: boolean;
        preload: boolean
    },
    xframe?: true | 'deny' | 'sameorigin' | {
        rule: 'deny' | 'sameorigin' | 'allow-from',
        source: string
    },
    xss?: boolean,
    noOpen?: boolean,
    noSniff?: boolean,
    referrer?: object,
}

export type validationFactory = (api: validation) => {
    [name: string]: () => {
        description?: string,
        auth?: auth,
        cors?: cors,
        timeout?: timeout,
        security?: security,
        params: joi.Schema,
        result: joi.Schema
    } | {
        description?: string,
        method: 'GET' | 'PUT' | 'POST' | 'DELETE',
        path: string,
        auth?: auth,
        cors?: cors,
        timeout?: timeout,
        security?: security,
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
export type validationMap = {
    [name: string]: validationFactory
}
export type handlerSet<methods, errors, exports> = (api: api<errors>) => handlerOrLib<methods, errors, exports>[]

type schema = {
    path: string,
    linkSP?: boolean,
    config: {}
}

type microserviceResult = {
    config: () => {
        validation: (api: {joi: joi.Root}) => joi.Schema
    },
    adapter?: () => ((api: api<{}>) => {
        namespace: string | string[],
        schema: schema[]
    } | {
        seed: schema[]
    })[],
    gateway?: () => validationSet[],
    test?: () => (((api: api<{}>) => {}) | validationFactory)[]
} & {
    [layer: string]: (handlerSet<{}, {}, {}> | validationSet)[] | unknown
}

export function run(params: {
    method: 'types',
    main: () => {}[][],
    config: {}
} | {
    method?: 'debug',
    version: string,
    root: string,
    resolve: NodeJS.RequireResolve,
    params: {}
} | {
    method: 'unit'
}): void;

type microserviceExport = () => () => microserviceResult;
type microserviceExportRun = {
    run: typeof run,
    (): () => microserviceResult
}

export function microservice(module: Partial<NodeJS.Module>, require: NodeJS.Require, fn?: microserviceExport): microserviceExportRun;
