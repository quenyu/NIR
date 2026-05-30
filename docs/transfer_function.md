# TransferFunction

`TransferFunction` is a universal continuous-time SISO block for structural control-system diagrams. It represents a transfer function

```text
W(s) = numerator(s) / denominator(s)
```

The block has one input port, `in`, and one output port, `out`.

## Coefficient Format

`numerator` and `denominator` are arrays of finite numbers. Coefficients are written in descending powers of `s`.

```json
{
  "numerator": [1, 3],
  "denominator": [1, 2, 5]
}
```

This means:

```text
W(s) = (s + 3) / (s^2 + 2s + 5)
```

Validation rules:
- `numerator` must not be empty;
- `denominator` must not be empty;
- the leading denominator coefficient must not be zero;
- all coefficients must be finite numbers;
- `numerator` order must not be greater than `denominator` order.

Improper transfer functions are rejected because the current simulator does not support direct realization of derivatives of the input signal.

## Examples

Stable first-order lag:

```text
W(s) = 1 / (s + 1)
numerator = [1]
denominator = [1, 1]
```

Unstable first-order link:

```text
W(s) = 1 / (s - 1)
numerator = [1]
denominator = [1, -1]
```

Integrator on the stability boundary:

```text
W(s) = 1 / s
numerator = [1]
denominator = [1, 0]
```

Second-order stable link:

```text
W(s) = 1 / (s^2 + 2s + 5)
numerator = [1]
denominator = [1, 2, 5]
```

## Stability Analysis

For each `TransferFunction`, the backend computes poles as roots of `denominator`.

- `stable`: all pole real parts are less than 0;
- `unstable`: at least one pole real part is greater than 0;
- `marginal`: at least one pole real part is close to 0 and none are positive.

The current implementation analyzes individual `TransferFunction` blocks. A full assembled state-space stability analysis for the complete diagram remains future work.

## Strictly Proper And Direct-Feedthrough

A transfer function is strictly proper when:

```text
order(numerator) < order(denominator)
```

Strictly proper dynamic blocks have no direct `D * u` term in state-space output:

```text
y = Cx
```

They can break feedback loops because their output depends only on the current state.

A proper but not strictly proper transfer function has:

```text
order(numerator) == order(denominator)
```

It has direct feedthrough:

```text
y = Cx + D u
```

This means the output depends instantly on the input. If such a block participates in a feedback loop containing only direct-feedthrough or static blocks, the diagram has an algebraic loop. The validator rejects that case because the current simulator does not solve algebraic equations inside a time step.
