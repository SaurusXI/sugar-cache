export type DecoratedMethod<TThis, TArgs extends any[]> = (
    _originalMethod: Function,
    _context: ClassMethodDecoratorContext<
        TThis,
        (_this: TThis, ..._args: TArgs) => any
    >
) => void;
