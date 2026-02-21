export type ReadingToken = string;

export interface VariantConfig {
  zero?: "rei" | "zero";
  four?: "yon" | "shi";
  seven?: "nana" | "shichi";
  nine?: "kyu" | "ku";
}

export type CoreVariantId = "zero" | "four" | "seven" | "nine";

export interface ReadOptions {
  variant?: VariantConfig;
  mode?: Record<string, string>;
  strict?: boolean;
}

export interface ReadResult {
  input: string;
  normalized: string;
  number: bigint | string;
  counterId?: string;
  modeUsed?: string;
  tokens: ReadingToken[];
  reading: string;
}

export interface YomiJa {
  read(input: string, options?: ReadOptions): string | null;
  readDetailed(input: string, options?: ReadOptions): ReadResult | null;
  readNumber(n: bigint, options?: ReadOptions): string;
  replaceInText(input: string, options?: ReadOptions): string;
}

export interface CoreRules {
  variants: {
    zero: { rei: string; zero: string };
    four: { yon: string; shi: string };
    seven: { nana: string; shichi: string };
    nine: { kyu: string; ku: string };
  };
  defaultVariant: {
    zero: "rei" | "zero";
    four: "yon" | "shi";
    seven: "nana" | "shichi";
    nine: "kyu" | "ku";
  };
  digits: Record<string, ReadingToken[]>;
  specialHundreds: Record<string, ReadingToken[]>;
  specialThousands: Record<string, ReadingToken[]>;
  smallUnits: {
    [unit: string]: ReadingToken[];
  };
  bigUnits: Array<{ pow10: number; reading: ReadingToken[] }>;
  minus: ReadingToken[];
}

export interface SurfaceRules {
  prefix?: string[];
  suffix?: string[];
}

export interface ComposeConcat {
  type: "concat";
  suffixReading: ReadingToken[];
}

export interface ComposeExceptionsFirst {
  type: "exceptions_first";
  exceptions: Record<string, ReadingToken[]>;
  fallback: ComposeFallback;
}

export type ComposeFallback = ComposeConcat | PatternCompose;

export interface PatternCompose {
  type: "pattern";
  patternId: string;
  forms: Record<string, ReadingToken[]>;
}

export type CounterCompose = ComposeConcat | ComposeExceptionsFirst | PatternCompose;

export interface CounterMode {
  compose: CounterCompose;
}

export interface CounterDefinition {
  surface?: SurfaceRules;
  compose?: CounterCompose;
  modes?: Record<string, CounterMode>;
  defaultMode?: string;
}

export interface PatternRule {
  type: "tail_form_selector";
  rules: Array<{
    whenTailIn: ReadingToken[];
    rewriteTail?: Record<string, string>;
    useForm?: string;
  }>;
  defaultForm: string;
}

export interface PatternDefinitions {
  patterns: Record<string, PatternRule>;
}

export interface CounterDefinitions {
  counters: Record<string, CounterDefinition>;
}

export interface RuleBundle {
  core: CoreRules;
  patterns: PatternDefinitions;
  counters: CounterDefinitions;
}
