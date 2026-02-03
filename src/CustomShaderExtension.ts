import { LayerExtension } from '@deck.gl/core';
import { getDefaultPalette, padColors } from './utils';

const apply_transparent_color = `\
vec4 apply_transparent_color(vec3 color, vec3 transparentColor, bool useTransparentColor, float opacity){
  return vec4(color, (color == transparentColor && useTransparentColor) ? 0. : opacity);
}
`;
const fs = `\
uniform vec3 transparentColor;
uniform bool useTransparentColor;
uniform float opacity;

uniform vec3 colors[6];

${apply_transparent_color}

// linearize 

void mutate_color(inout vec3 rgb, float intensity0, float intensity1, float intensity2, float intensity3, float intensity4, float intensity5) { 
  rgb += max(0.0, min(1.0, intensity0)) * vec3(colors[0]);
  rgb += max(0.0, min(1.0, intensity1)) * vec3(colors[1]);
  rgb += max(0.0, min(1.0, intensity2)) * vec3(colors[2]);
  rgb += max(0.0, min(1.0, intensity3)) * vec3(colors[3]);
  rgb += max(0.0, min(1.0, intensity4)) * vec3(colors[4]);
  rgb += max(0.0, min(1.0, intensity5)) * vec3(colors[5]);
}

vec4 apply_opacity(vec3 rgb) {
  return vec4(apply_transparent_color(rgb, transparentColor, useTransparentColor, opacity));
}
`;

const DECKGL_MUTATE_COLOR = `\
vec3 rgb = rgba.rgb;
mutate_color(rgb, intensity0, intensity1, intensity2, intensity3, intensity4, intensity5);
rgba = apply_opacity(rgb);
`;

const defaultProps = {
  colors: { type: 'array', value: null, compare: true },
  opacity: { type: 'number', value: 1.0, compare: true },
  transparentColor: { type: 'array', value: null, compare: true },
  useTransparentColor: { type: 'boolean', value: false, compare: true },
  fragmentShader: { type: 'string', value: null, compare: true },
  mutateColorCode: { type: 'string', value: null, compare: true }
};
/**
 * This deck.gl extension allows for a color palette to be used for pseudo-coloring channels.
 * @typedef LayerProps
 * @type {object}
 * @property {Array<Array<number>>=} colors Array of colors to map channels to (RGB).
 * @property {number=} opacity Opacity of the layer.
 * @property {Array.<number>=} transparentColor An RGB (0-255 range) color to be considered "transparent" if provided.
 * In other words, any fragment shader output equal transparentColor (before applying opacity) will have opacity 0.
 * @property {Boolean=} useTransparentColor Whether or not to use the value provided to transparentColor.
 * @property {string=} fragmentShader Custom fragment shader code to use instead of the default. 
 * Must include uniforms, functions, and the mutate_color function. The DECKGL_MUTATE_COLOR injection point will be replaced.
 * @property {string=} mutateColorCode Custom code to inject at the DECKGL_MUTATE_COLOR injection point.
 * If not provided, uses the default mutation code. Must assign to rgba variable.
 */
function hashForCache(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

const CustomShaderExtension = class extends LayerExtension {
  getShaders() {
    // @ts-ignore - deck.gl LayerExtension getShaders signature
    const baseShaders = super.getShaders();
    const props = (this as any).props ?? (this as any).opts ?? {};
    const customFragmentShader = props.fragmentShader;
    const customMutateColorCode = props.mutateColorCode;
    
    // Use custom shader if provided, otherwise use default
    const shaderCode = customFragmentShader || fs;
    const mutateCode = customMutateColorCode || DECKGL_MUTATE_COLOR;
    
    // Unique name per shader to bypass any module cache (deck.gl/luma.gl may cache by name)
    const moduleName = `color-palette-module-${hashForCache(shaderCode + mutateCode)}`;
    
    const colorPaletteModule = {
      name: moduleName,
      fs: shaderCode,
      inject: {
        'fs:DECKGL_MUTATE_COLOR': mutateCode
      }
    };
    
    return {
      ...baseShaders,
      modules: [colorPaletteModule]
    };
  }

  draw() {
    const props = (this as any).props as any;
    const state = (this as any).state as any;
    const {
      colors,
      channelsVisible,
      opacity = defaultProps.opacity.value,
      transparentColor = defaultProps.transparentColor.value,
      useTransparentColor = defaultProps.useTransparentColor.value,
      selections
    } = props;
    const paddedColors = padColors({
      channelsVisible: channelsVisible || selections?.map(() => true) || [],
      colors: colors || getDefaultPalette(selections?.length || 1)
    });
    const uniforms = {
      colors: paddedColors,
      opacity,
      transparentColor: (transparentColor || [0, 0, 0]).map((i: number) => i / 255),
      useTransparentColor: Boolean(useTransparentColor)
    };
    state.model?.setUniforms(uniforms);
  }
};

CustomShaderExtension.extensionName = 'CustomShaderExtension';
CustomShaderExtension.defaultProps = defaultProps;

// Export defaults for reference
export const defaultFragmentShader = fs;
export const defaultMutateColorCode = DECKGL_MUTATE_COLOR;

// Export the full fragment shader for display
export const fragmentShader = fs + '\n\n// Injection point:\n' + DECKGL_MUTATE_COLOR;

export default CustomShaderExtension;