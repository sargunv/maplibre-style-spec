import {
    NumberType,
    ValueType,
    FormattedType,
    array,
    StringType,
    ColorType,
    ResolvedImageType,
} from '../types';
import {Formatted, FormattedSection} from '../types/formatted';
import {valueToString, typeOf} from '../values';

import type {Expression} from '../expression';
import type {EvaluationContext} from '../evaluation_context';
import type {ParsingContext} from '../parsing_context';
import type {Type} from '../types';

type FormattedSectionExpression = {
    // Content of a section may be Image expression or other
    // type of expression that is coercable to 'string'.
    content: Expression;
    scale: Expression | null;
    font: Expression | null;
    textColor: Expression | null;
};

export class FormatExpression implements Expression {
    type: Type;
    sections: Array<FormattedSectionExpression>;

    constructor(sections: Array<FormattedSectionExpression>) {
        this.type = FormattedType;
        this.sections = sections;
    }

    static parse(args: ReadonlyArray<unknown>, context: ParsingContext): Expression {
        if (args.length < 2) {
            return context.error('Expected at least one argument.') as null;
        }

        const firstArg = args[1];
        if (!Array.isArray(firstArg) && typeof firstArg === 'object')  {
            return context.error('First argument must be an image or text section.') as null;
        }

        const sections: Array<FormattedSectionExpression> = [];
        let nextTokenMayBeObject = false;
        for (let i = 1; i <= args.length - 1; ++i) {
            const arg = (args[i] as any);

            if (nextTokenMayBeObject && typeof arg === 'object' && !Array.isArray(arg)) {
                nextTokenMayBeObject = false;

                let scale = null;
                if (arg['font-scale']) {
                    scale = context.parse(arg['font-scale'], 1, NumberType);
                    if (!scale) return null;
                }

                let font = null;
                if (arg['text-font']) {
                    font = context.parse(arg['text-font'], 1, array(StringType));
                    if (!font) return null;
                }

                let textColor = null;
                if (arg['text-color']) {
                    textColor = context.parse(arg['text-color'], 1, ColorType);
                    if (!textColor) return null;
                }

                const lastExpression = sections[sections.length - 1];
                lastExpression.scale = scale;
                lastExpression.font = font;
                lastExpression.textColor = textColor;
            } else {
                const content = context.parse(args[i], 1, ValueType);
                if (!content) return null;

                const kind = content.type.kind;
                if (kind !== 'string' && kind !== 'value' && kind !== 'null' && kind !== 'resolvedImage')
                    return context.error('Formatted text type must be \'string\', \'value\', \'image\' or \'null\'.') as null;

                nextTokenMayBeObject = true;
                sections.push({content, scale: null, font: null, textColor: null});
            }
        }

        return new FormatExpression(sections);
    }

    evaluate(ctx: EvaluationContext) {
        const evaluateSection = section => {
            const evaluatedContent = section.content.evaluate(ctx);
            if (typeOf(evaluatedContent) === ResolvedImageType) {
                return new FormattedSection('', evaluatedContent, null, null, null);
            }

            return new FormattedSection(
                valueToString(evaluatedContent),
                null,
                section.scale ? section.scale.evaluate(ctx) : null,
                section.font ? section.font.evaluate(ctx).join(',') : null,
                section.textColor ? section.textColor.evaluate(ctx) : null
            );
        };

        return new Formatted(this.sections.map(evaluateSection));
    }

    eachChild(fn: (_: Expression) => void) {
        for (const section of this.sections) {
            fn(section.content);
            if (section.scale) {
                fn(section.scale);
            }
            if (section.font) {
                fn(section.font);
            }
            if (section.textColor) {
                fn(section.textColor);
            }
        }
    }

    outputDefined() {
        // Technically the combinatoric set of all children
        // Usually, this.text will be undefined anyway
        return false;
    }
}
