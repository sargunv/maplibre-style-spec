import {describe, expect, test} from 'vitest';
import {createExpression, createPropertyExpression} from './index';
import {validateExpression} from '../validate/validate_expression';
import v8 from '../reference/v8.json' with {type: 'json'};
import type {StylePropertySpecification} from '..';

const widthSpec = v8.paint_line['line-width'] as StylePropertySpecification;

describe('latitude', () => {
    test('reads signed camera latitude on every evaluation, including inside arithmetic', () => {
        const result = createExpression(['cos', ['*', ['latitude'], ['/', ['pi'], 180]]], 'test');
        expect(result.result).toBe('success');
        if (result.result !== 'success') throw new Error('parse failed');
        for (const latitude of [0, 60, -60, 90]) {
            expect(result.value.evaluateWithoutErrorHandling({zoom: 10, latitude})).toBeCloseTo(
                Math.cos((latitude * Math.PI) / 180)
            );
        }
        expect(() => result.value.evaluateWithoutErrorHandling({zoom: 10})).toThrow(
            'requires a map center latitude'
        );
        expect(createExpression(['latitude', 1], 'test').result).toBe('error');
    });

    test('tracks latitude independently of zoom and feature dependency', () => {
        const result = createPropertyExpression(
            [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                ['/', ['get', 'width'], ['cos', ['*', ['latitude'], ['/', ['pi'], 180]]]],
                1,
                ['/', ['*', 2, ['get', 'width']], ['cos', ['*', ['latitude'], ['/', ['pi'], 180]]]]
            ],
            'layers[0].paint.line-width',
            widthSpec,
            {}
        );
        expect(result.result).toBe('success');
        if (result.result !== 'success') throw new Error('parse failed');
        expect(result.value.kind).toBe('composite');
        expect(result.value.isLatitudeDependent).toBe(true);
        const feature = {type: 'LineString' as const, properties: {width: 10}};
        expect(result.value.evaluate({zoom: 0.5, latitude: 0}, feature)).toBeCloseTo(
            10 * Math.SQRT2
        );
        expect(result.value.evaluate({zoom: 0.5, latitude: 60}, feature)).toBeCloseTo(
            20 * Math.SQRT2
        );
        const latitudeOnly = createPropertyExpression(
            ['abs', ['latitude']],
            'layers[0].paint.line-width',
            widthSpec,
            {}
        );
        if (latitudeOnly.result !== 'success') throw new Error('parse failed');
        expect(latitudeOnly.value.isLatitudeDependent).toBe(true);
        expect(latitudeOnly.value.evaluate({zoom: 0, latitude: -42})).toBe(42);
    });

    test('rejects unsupported contexts but preserves literal data and zoom restrictions', () => {
        for (const expressionContext of [
            'filter',
            'cluster-map',
            'cluster-reduce',
            'cluster-initial'
        ]) {
            const errors = validateExpression({
                key: 'test',
                value: ['latitude'],
                expressionContext
            });
            expect(errors[0].message).toContain('only supported in camera-enabled');
        }
        expect(
            createPropertyExpression(['latitude'], 'test', {
                type: 'number',
                'property-type': 'constant'
            } as StylePropertySpecification).result
        ).toBe('error');
        expect(
            createPropertyExpression(['*', ['zoom'], ['latitude']], 'test', widthSpec).result
        ).toBe('error');
        const literal = createExpression(['literal', ['latitude']], 'test');
        if (literal.result !== 'success') throw new Error('parse failed');
        expect(literal.value.evaluate({zoom: 0})).toEqual(['latitude']);
    });
});
