declare module "react-katex" {
  import type { ReactElement, ReactNode } from "react";

  interface MathComponentProps {
    math?: string;
    children?: ReactNode;
    errorColor?: string;
    renderError?: (error: Error) => ReactNode;
  }

  export function InlineMath(props: MathComponentProps): ReactElement;
  export function BlockMath(props: MathComponentProps): ReactElement;
}
