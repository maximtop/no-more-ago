/**
 * @file TypeScript module declaration for CSS imports bundled by Rspack.
 */

declare module "*.css" {
    const value: string;
    export default value;
}
