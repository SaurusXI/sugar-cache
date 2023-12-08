export type DecoratedMethod<TThis, TArgs extends any[], TReturn> = (
    _originalMethod: Function,
    _context: ClassMethodDecoratorContext<
        TThis,
        (_this: TThis, ..._args: TArgs) => TReturn
    >
) => void;
