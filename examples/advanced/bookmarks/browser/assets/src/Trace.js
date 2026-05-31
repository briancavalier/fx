import { getTraceCapturePolicy, setTraceCapturePolicy } from './internal/tracePolicy.js';
import { activeScopes, capturesTrace, withRuntimeContext } from './internal/runtimeContext.js';
export { getTraceCapturePolicy, setTraceCapturePolicy };
export const MaxTraceDepth = 32;
export const TraceTypeId = Symbol.for('fx/Trace');
export const traceFrom = (origin, parent, metadata) => prependTrace(origin, parent, metadata);
export const captureTrace = (origin, parent, metadata) => captureTraceWith(origin, parent, metadata);
export const prependTrace = (origin, parent, metadata) => prependFrame({ message: origin.message, stackSource: origin, ...metadata }, parent);
export const capturePrependTrace = (origin, parent, metadata) => capturePrependTraceWith(origin, parent, metadata);
export const appendTrace = (trace, parent) => {
    if (parent === undefined)
        return trace;
    if (trace.acyclic && parent.acyclic && !trace.truncated && !parent.truncated && trace.depth + parent.depth <= MaxTraceDepth) {
        return appendTraceFast(trace, parent);
    }
    const frames = [];
    let truncated = trace.truncated || parent.truncated;
    const seen = new Set();
    const roots = [trace, parent];
    for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        let current = root;
        while (current !== undefined && !seen.has(current) && frames.length < MaxTraceDepth) {
            seen.add(current);
            frames.push(current.frame);
            current = current.parent;
        }
        if (current !== undefined)
            truncated = true;
        if (frames.length >= MaxTraceDepth) {
            if (i < roots.length - 1)
                truncated = true;
            break;
        }
    }
    return fromFrames(frames, truncated, trace.activeScopes);
};
export const captureAppendTrace = (trace, parent) => captureAppendTraceWith(trace, parent);
const captureTraceWith = (origin, parent, metadata) => capturesTrace() ? prependTrace(origin, parent, metadata) : undefined;
const capturePrependTraceWith = (origin, parent, metadata) => capturesTrace() ? prependTrace(origin, parent, metadata) : parent;
const captureAppendTraceWith = (trace, parent) => {
    if (!capturesTrace())
        return undefined;
    if (trace === undefined)
        return parent;
    return appendTrace(trace, parent);
};
/**
 * Run an Fx region with the specified trace capture policy.
 *
 * The policy applies to trace captures performed while the returned Fx executes.
 * Fx values constructed before entering the region keep any trace metadata they
 * already captured.
 */
export const withTraceCapture = (policy) => (fx) => withRuntimeContext({ traceCapturePolicy: policy }, fx);
export const attachTrace = (error, trace) => {
    Object.defineProperty(error, TraceTypeId, {
        value: trace,
        enumerable: false,
        writable: false,
        configurable: true
    });
};
export const getTrace = (error) => typeof error === 'object' && error !== null
    ? error[TraceTypeId]
    : undefined;
export const snapshotTrace = (trace) => {
    const frames = [];
    const seen = new Set();
    let current = trace;
    while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        frames.push(snapshotFrame(current.frame));
        current = current.parent;
    }
    return {
        frames,
        ...(trace.activeScopes === undefined || trace.activeScopes.length === 0 ? {} : { activeScopes: trace.activeScopes }),
        truncated: trace.truncated,
        cycleDetected: current !== undefined
    };
};
export const snapshotError = (error) => snapshotErrorValue(error, new Set());
export const formatTrace = (trace) => {
    const lines = [];
    const seen = new Set();
    let current = trace;
    while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        lines.push(`  at ${current.frame.message}`);
        const location = firstStackLocation(current.frame.stackSource?.stack);
        if (location !== undefined)
            lines.push(`     ${location.raw}`);
        current = current.parent;
    }
    if (current !== undefined)
        lines.push('  <trace cycle detected>');
    else if (trace.truncated)
        lines.push('  <trace truncated; older frames omitted>');
    return lines.join('\n');
};
export const formatError = (error) => {
    const aggregate = aggregateErrors(error);
    if (aggregate !== undefined)
        return formatAggregateErrorValue(error, aggregate);
    const trace = getTrace(error);
    if (trace === undefined)
        return formatErrorValue(error);
    return [
        formatErrorValue(rootCause(error)),
        ...formatActiveScopes(trace.activeScopes),
        formatTrace(trace)
    ].join('\n');
};
export const formatDiagnostic = (error, options) => {
    const lines = [];
    formatDiagnosticError(snapshotError(error), lines, 0, formatContext(options));
    return lines.join('\n');
};
const prependFrame = (frame, parent) => {
    const scopes = traceActiveScopes(parent);
    if (parent === undefined)
        return { frame, ...scopes, depth: 1, truncated: false, acyclic: true };
    if (parent.depth < MaxTraceDepth) {
        return {
            frame,
            parent,
            ...scopes,
            depth: parent.depth + 1,
            truncated: parent.truncated,
            acyclic: parent.acyclic
        };
    }
    const frames = [frame];
    let current = parent;
    while (current !== undefined && frames.length < MaxTraceDepth) {
        frames.push(current.frame);
        current = current.parent;
    }
    return fromFrames(frames, true, scopes.activeScopes);
};
const fromFrames = (frames, truncated, activeScopes) => {
    let trace;
    for (let i = frames.length - 1; i >= 0; i--) {
        trace = {
            frame: frames[i],
            parent: trace,
            ...(i === 0 && activeScopes !== undefined && activeScopes.length > 0 ? { activeScopes } : {}),
            depth: (trace?.depth ?? 0) + 1,
            truncated,
            acyclic: true
        };
    }
    return trace;
};
const appendTraceFast = (trace, parent) => {
    const frames = [];
    let current = trace;
    while (current !== undefined) {
        frames.push(current.frame);
        current = current.parent;
    }
    current = parent;
    while (current !== undefined) {
        frames.push(current.frame);
        current = current.parent;
    }
    return fromFrames(frames, false, trace.activeScopes);
};
const traceActiveScopes = (parent) => {
    const scopes = activeScopes();
    if (scopes.length > 0)
        return { activeScopes: scopes };
    if (parent?.activeScopes !== undefined && parent.activeScopes.length > 0)
        return { activeScopes: parent.activeScopes };
    return {};
};
const firstStackLocation = (stack) => {
    if (stack === undefined)
        return undefined;
    const lines = stack.split('\n');
    let fallback;
    for (let i = 1; i < lines.length; i++) {
        const location = parseStackLocation(lines[i].trim());
        fallback ??= location;
        if (!isTraceTrampolineLocation(location))
            return location;
    }
    return fallback;
};
const parseStackLocation = (raw) => {
    const trimmed = raw.replace(/^at\s+/, '');
    const call = /^(.*?) \((.*):(\d+):(\d+)\)$/.exec(trimmed);
    if (call !== null) {
        return {
            raw,
            functionName: call[1],
            file: call[2],
            line: Number(call[3]),
            column: Number(call[4])
        };
    }
    const location = /^(.*):(\d+):(\d+)$/.exec(trimmed);
    if (location !== null) {
        return {
            raw,
            file: location[1],
            line: Number(location[2]),
            column: Number(location[3])
        };
    }
    return { raw };
};
const isTraceTrampolineLocation = (location) => {
    if (location.file === undefined)
        return false;
    const file = location.file.replaceAll('\\', '/');
    if (file.endsWith('/src/internal/pipe.ts') || file.endsWith('/dist/internal/pipe.js'))
        return true;
    const isGeneratorPipe = location.functionName?.endsWith('.pipe') ?? false;
    return isGeneratorPipe && (file.endsWith('/src/internal/generator.ts') || file.endsWith('/dist/internal/generator.js'));
};
const snapshotFrame = (frame) => {
    const location = firstStackLocation(frame.stackSource?.stack);
    return {
        message: frame.message,
        ...(frame.kind === undefined ? {} : { kind: frame.kind }),
        ...(frame.index === undefined ? {} : { index: frame.index }),
        ...(location === undefined ? {} : { location })
    };
};
const snapshotErrorValue = (error, seen) => {
    if (tracksCycles(error) && seen.has(error))
        return {
            type: typeOf(error),
            message: '[cycle]',
            cycleDetected: true
        };
    if (tracksCycles(error))
        seen.add(error);
    if (isFailEffect(error))
        return snapshotFail(error, seen);
    const trace = getTrace(error);
    const base = error instanceof Error
        ? snapshotErrorObject(error)
        : {
            type: typeOf(error),
            message: String(error)
        };
    const cause = hasCause(error) ? error.cause : undefined;
    const aggregate = aggregateErrors(error);
    return {
        ...base,
        ...(trace === undefined ? {} : { trace: snapshotTrace(trace) }),
        ...(cause === undefined ? {} : { cause: snapshotErrorValue(cause, seen) }),
        ...(aggregate === undefined ? {} : { aggregate: { errors: aggregate.map(e => snapshotErrorValue(e, seen)) } })
    };
};
const snapshotFail = (failure, seen) => ({
    ...snapshotErrorValue(failure.arg, seen),
    ...(failure.trace === undefined ? {} : { trace: snapshotTrace(failure.trace) })
});
const isFailEffect = (value) => typeof value === 'object'
    && value !== null
    && value._fxEffectId === 'fx/Fail';
const snapshotErrorObject = (error) => ({
    type: error.constructor.name,
    name: error.name,
    message: error.message,
    ...('code' in error ? { code: String(error.code) } : {}),
    ...snapshotErrorFields(error)
});
const snapshotErrorFields = (error) => {
    const fields = Object.keys(error)
        .filter(key => !excludedErrorFields.has(key))
        .map(key => ({ key, value: formatDiagnosticFieldValue(error[key], new Set([error])) }));
    return fields.length === 0 ? {} : { fields };
};
const excludedErrorFields = new Set(['name', 'message', 'stack', 'cause', 'errors', 'code']);
const aggregateErrors = (error) => {
    if (error instanceof AggregateError)
        return Array.from(error.errors);
    if (error instanceof Error
        && error.name === 'RaceAllFailed'
        && 'errors' in error
        && Array.isArray(error.errors))
        return error.errors;
    return undefined;
};
const formatActiveScopes = (scopes, context) => {
    if (scopes === undefined || scopes.length === 0)
        return [];
    const label = context?.style.section('Active scopes') ?? 'Active scopes';
    return [`${label}: ${compactActiveScopes(scopes).map(formatActiveScopeLabel).join(' > ')}`];
};
const compactActiveScopes = (scopes) => scopes.length <= 4 ? scopes : [scopes[0], '...', ...scopes.slice(-3)];
const formatActiveScopeLabel = (scope) => scope === '...' ? '...' : scope.label;
const formatContext = (options) => ({
    style: colorEnabled(options?.colors ?? 'auto') ? ansiStyle : plainStyle,
    ...(options?.source === undefined || options.source === false
        ? {}
        : {
            source: {
                lookup: options.source.lookup,
                contextLines: options.source.contextLines ?? 1
            }
        })
});
const formatDiagnosticError = (error, lines, indent, context, options = {}) => {
    const prefix = ' '.repeat(indent);
    lines.push(`${prefix}${formatDiagnosticHeader(error, context)}`);
    formatDiagnosticFields(error.fields, lines, indent, context);
    const activeScopes = formatActiveScopes(error.trace?.activeScopes, context);
    if (activeScopes.length > 0)
        lines.push(`${prefix}${activeScopes[0]}`);
    if (error.trace !== undefined) {
        const omitTraceSuffix = options.omitTraceSuffix ?? 0;
        const frames = omitTraceSuffix === 0 ? error.trace.frames : error.trace.frames.slice(0, -omitTraceSuffix);
        if (traceAlreadyShown(frames, options.parentTraceFrames)) {
            lines.push(`${prefix}  ${context.style.section('<trace already shown above>')}`);
        }
        else {
            formatDiagnosticTrace(frames, error.trace, lines, indent, context, omitTraceSuffix === 0, options.sourceSnippets ?? true);
        }
    }
    if (error.cause !== undefined) {
        lines.push(`${prefix}${context.style.section('Caused by:')}`);
        formatDiagnosticError(error.cause, lines, indent + 2, context, {
            parentTraceFrames: displayedTraceFrames(error, options.omitTraceSuffix ?? 0)
        });
    }
    if (error.aggregate !== undefined) {
        formatDiagnosticAggregate(error, lines, indent, context);
    }
};
const formatDiagnosticHeader = (error, context) => {
    const code = error.code === undefined ? '' : ` ${context.style.code(`[${error.code}]`)}`;
    const name = error.name ?? error.type;
    const message = error.message === '' ? '' : `: ${error.message}`;
    return context.style.header(`${name}${code}${message}`);
};
const formatDiagnosticFields = (fields, lines, indent, context) => {
    if (fields === undefined || fields.length === 0)
        return;
    const prefix = ' '.repeat(indent + 2);
    for (const field of fields) {
        lines.push(`${prefix}${context.style.code(field.key)}: ${field.value}`);
    }
};
const formatDiagnosticAggregate = (error, lines, indent, context) => {
    const prefix = ' '.repeat(indent);
    const errors = error.aggregate?.errors ?? [];
    const sharedSuffixLength = sharedTraceSuffixLength(errors);
    const label = error.name === 'RaceAllFailed'
        ? 'Failed race children:'
        : 'Aggregate errors:';
    lines.push(`${prefix}${context.style.section(label)}`);
    for (let i = 0; i < errors.length; i++) {
        lines.push(`${prefix}  ${context.style.section(`[${i}]`)}`);
        formatDiagnosticError(errors[i], lines, indent + 4, context, { omitTraceSuffix: sharedSuffixLength });
    }
    if (sharedSuffixLength > 0) {
        const trace = firstTrace(errors);
        if (trace !== undefined) {
            lines.push(`${prefix}${context.style.section('Shared parent trace:')}`);
            formatDiagnosticTrace(trace.frames.slice(-sharedSuffixLength), trace, lines, indent + 2, context, true, false);
        }
    }
};
const formatDiagnosticTrace = (frames, trace, lines, indent, context, includeStatus, sourceSnippets) => {
    const prefix = ' '.repeat(indent);
    let snippetRendered = false;
    if (frames.length > 0) {
        lines.push(`${prefix}${context.style.section('Fx trace:')}`);
        for (const frame of compactConcurrencyFrames(frames)) {
            lines.push(`${prefix}  at ${formatSnapshotFrame(frame, context)}`);
            if (frame.location !== undefined) {
                lines.push(`${prefix}     ${formatTraceLocation(frame.location, context)}`);
                if (sourceSnippets && !snippetRendered && formatSourceSnippet(frame.location, lines, indent + 5, context)) {
                    snippetRendered = true;
                }
            }
        }
    }
    if (includeStatus) {
        if (trace.cycleDetected)
            lines.push(`${prefix}  ${context.style.section('<trace cycle detected>')}`);
        else if (trace.truncated)
            lines.push(`${prefix}  ${context.style.section('<trace truncated; older frames omitted>')}`);
    }
};
const compactConcurrencyFrames = (frames) => frames.filter((frame, i) => !isSameLocationConcurrencyParent(frame, frames[i - 1]));
const isSameLocationConcurrencyParent = (frame, previous) => previous !== undefined
    && (frame.kind === 'all' || frame.kind === 'race')
    && frame.kind === previous.kind
    && frame.index === undefined
    && previous.index !== undefined
    && sameTraceLocation(frame, previous);
const sameTraceLocation = (a, b) => a.location !== undefined
    && b.location !== undefined
    && a.location.file === b.location.file
    && a.location.line === b.location.line
    && a.location.column === b.location.column;
const formatSnapshotFrame = (frame, context) => {
    const metadata = formatFrameMetadata(frame);
    const suffix = metadata === undefined ? '' : ` ${context.style.frameMetadata(`[${metadata}]`)}`;
    return `${frame.message}${suffix}`;
};
const formatFrameMetadata = (frame) => {
    if (frame.kind === undefined)
        return undefined;
    if ((frame.kind === 'all' || frame.kind === 'race') && frame.index !== undefined) {
        return `${frame.kind} child #${frame.index}`;
    }
    return frame.kind;
};
const formatTraceLocation = (location, context) => {
    const formatted = location.file === undefined
        ? location.raw
        : `${location.file}${location.line === undefined ? '' : `:${location.line}${location.column === undefined ? '' : `:${location.column}`}`}`;
    return context.style.location(formatted);
};
const formatSourceSnippet = (location, lines, indent, context) => {
    if (context.source === undefined
        || location.file === undefined
        || location.line === undefined
        || location.column === undefined
        || location.line < 1
        || location.column < 1)
        return false;
    const source = lookupSource(context.source.lookup, location);
    if (source === undefined)
        return false;
    const sourceLines = source.split(/\r\n|\n|\r/);
    const lineIndex = location.line - 1;
    if (lineIndex < 0 || lineIndex >= sourceLines.length)
        return false;
    const contextLines = Number.isFinite(context.source.contextLines)
        ? Math.max(0, Math.floor(context.source.contextLines))
        : 1;
    const start = Math.max(0, lineIndex - contextLines);
    const end = Math.min(sourceLines.length - 1, lineIndex + contextLines);
    const lineNumberWidth = String(end + 1).length;
    const prefix = ' '.repeat(indent);
    lines.push(`${prefix}${context.style.sourceGutter('|')}`);
    for (let i = start; i <= end; i++) {
        const lineNumber = String(i + 1).padStart(lineNumberWidth, ' ');
        const line = i === lineIndex
            ? formatTargetSourceLine(sourceLines[i], location.column, context)
            : context.style.sourceContext(sourceLines[i]);
        lines.push(`${prefix}${context.style.sourceGutter(`${lineNumber} |`)} ${line}`);
        if (i === lineIndex) {
            const caretColumn = Math.min(location.column, sourceLines[i].length + 1);
            lines.push(`${prefix}${context.style.sourceGutter(`${' '.repeat(lineNumberWidth)} |`)} ${' '.repeat(caretColumn - 1)}${context.style.sourceCaret('^')}`);
        }
    }
    return true;
};
const formatTargetSourceLine = (line, column, context) => {
    const splitIndex = Math.min(column - 1, line.length);
    return `${context.style.sourceTargetPrefix(line.slice(0, splitIndex))}${line.slice(splitIndex)}`;
};
const lookupSource = (lookup, location) => {
    try {
        return lookup(location);
    }
    catch {
        return undefined;
    }
};
const sharedTraceSuffixLength = (errors) => {
    if (errors.length < 2)
        return 0;
    const traces = errors.map(e => e.trace).filter((trace) => trace !== undefined && trace.frames.length > 0);
    if (traces.length !== errors.length)
        return 0;
    const minLength = Math.min(...traces.map(trace => trace.frames.length));
    let shared = 0;
    while (shared < minLength) {
        const key = traceFrameKey(traces[0].frames[traces[0].frames.length - 1 - shared]);
        if (!traces.every(trace => traceFrameKey(trace.frames[trace.frames.length - 1 - shared]) === key))
            break;
        shared += 1;
    }
    return shared;
};
const firstTrace = (errors) => errors.find(error => error.trace !== undefined)?.trace;
const traceFrameKey = (frame) => JSON.stringify([
    frame.message,
    frame.kind,
    frame.index,
    frame.location?.file,
    frame.location?.line,
    frame.location?.column,
    frame.location?.raw
]);
const displayedTraceFrames = (error, omitTraceSuffix) => {
    if (error.trace === undefined)
        return undefined;
    return omitTraceSuffix === 0 ? error.trace.frames : error.trace.frames.slice(0, -omitTraceSuffix);
};
const traceAlreadyShown = (frames, parentFrames) => frames.length > 0
    && parentFrames !== undefined
    && frames.length <= parentFrames.length
    && frames.every((frame, i) => traceFrameKey(frame) === traceFrameKey(parentFrames[i]));
const plainStyle = {
    header: identity,
    code: identity,
    location: identity,
    section: identity,
    frameMetadata: identity,
    sourceGutter: identity,
    sourceContext: identity,
    sourceTargetPrefix: identity,
    sourceCaret: identity
};
const ansiStyle = {
    header: ansi(1, 31),
    code: ansi(33),
    location: ansi(4, 36),
    section: ansi(2),
    frameMetadata: ansi(35),
    sourceGutter: ansi(2),
    sourceContext: ansi(2),
    sourceTargetPrefix: ansi(2),
    sourceCaret: ansi(1, 31)
};
const colorEnabled = (mode) => {
    if (mode === 'always')
        return true;
    if (mode === 'never')
        return false;
    const env = processEnv();
    if (env?.NO_COLOR !== undefined)
        return false;
    if (env?.FORCE_COLOR === '0')
        return false;
    if (env?.FORCE_COLOR !== undefined)
        return true;
    if (env?.TERM === 'dumb')
        return false;
    return processStdoutIsTty();
};
const processEnv = () => typeof process === 'object' && process !== null ? process.env : undefined;
const processStdoutIsTty = () => typeof process === 'object' && process !== null && process.stdout?.isTTY === true;
function ansi(...codes) {
    return (s) => `\u001b[${codes.join(';')}m${s}\u001b[0m`;
}
function identity(s) {
    return s;
}
const rootCause = (error) => {
    const seen = new Set();
    let current = error;
    while (hasCause(current) && !seen.has(current.cause)) {
        seen.add(current);
        current = current.cause;
    }
    return current;
};
const hasCause = (error) => typeof error === 'object' && error !== null && 'cause' in error;
const formatErrorValue = (error) => {
    if (error instanceof Error) {
        return error.message === '' ? error.name : `${error.name}: ${error.message}`;
    }
    return String(error);
};
const formatDiagnosticFieldValue = (value, seen) => {
    if (value === null)
        return 'null';
    switch (typeof value) {
        case 'string':
            return value;
        case 'number':
        case 'bigint':
        case 'boolean':
        case 'undefined':
            return String(value);
        case 'symbol':
            return value.description === undefined ? String(value) : `Symbol(${value.description})`;
        case 'function':
            return `[Function${value.name === '' ? '' : `: ${value.name}`}]`;
        case 'object':
            return formatDiagnosticFieldObject(value, seen);
    }
    return '[unknown]';
};
const formatDiagnosticFieldObject = (value, seen) => {
    if (seen.has(value))
        return '[cycle]';
    if (value instanceof Error)
        return formatErrorValue(value);
    if (value instanceof URL)
        return String(value);
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${formatFieldEntries(value.slice(0, MaxDiagnosticFieldEntries).map(v => formatDiagnosticFieldValue(v, seen)), value.length)}]`;
        }
        if (isPlainObject(value)) {
            const keys = Object.keys(value);
            const entries = keys.slice(0, MaxDiagnosticFieldEntries).map(key => `${key}: ${formatDiagnosticFieldValue(value[key], seen)}`);
            return `{ ${formatFieldEntries(entries, keys.length)} }`;
        }
        return Object.prototype.toString.call(value);
    }
    finally {
        seen.delete(value);
    }
};
const formatFieldEntries = (entries, total) => {
    const suffix = total > entries.length ? `, ... ${total - entries.length} more` : '';
    return `${entries.join(', ')}${suffix}`;
};
const MaxDiagnosticFieldEntries = 6;
const isPlainObject = (value) => {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};
const formatAggregateErrorValue = (error, aggregate) => [
    formatErrorValue(error),
    ...aggregate.map((error, i) => `  [${i}] ${formatErrorValue(rootCause(error))}`)
].join('\n');
const typeOf = (value) => value === null ? 'null' : typeof value;
const tracksCycles = (value) => (typeof value === 'object' && value !== null) || typeof value === 'function';
