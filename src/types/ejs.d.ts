/**
 * Minimal ambient types for `ejs`.
 *
 * The package ships no declarations and `@types/ejs` is not installed. Without this, the
 * import is `any` implicitly and `strict` fails the build with TS7016.
 *
 * Scoped to what `pdf.service.ts` actually calls — `renderFile`. Declaring the whole
 * module surface would be idle work for one function and would go stale silently.
 */
declare module 'ejs' {
	export interface RenderFileOptions {
		async?: boolean;
		cache?: boolean;
		rmWhitespace?: boolean;
		filename?: string;
		root?: string | string[];
		context?: Record<string, unknown>;
		delimiter?: string;
		openDelimiter?: string;
		closeDelimiter?: string;
		compileDebug?: boolean;
		client?: boolean;
		debug?: boolean;
		strict?: boolean;
		localsName?: string;
		escapeFunction?: (str: string) => string;
		outputFunctionName?: string;
		destructuredLocals?: string[];
	}

	/** Renders a template file to an HTML string. */
	export function renderFile(
		path: string,
		data?: Record<string, unknown>,
		options?: RenderFileOptions,
	): Promise<string>;

	/** Callback form, kept because EJS's overloads depend on it. */
	export function renderFile(
		path: string,
		data: Record<string, unknown> | undefined,
		options: RenderFileOptions | undefined,
		callback: (err: Error | null, str?: string) => void,
	): void;

	/** Renders a template string. */
	export function render(
		template: string,
		data?: Record<string, unknown>,
		options?: RenderFileOptions,
	): string;

	const ejs: {
		renderFile: typeof renderFile;
		render: typeof render;
	};
	export default ejs;
}
