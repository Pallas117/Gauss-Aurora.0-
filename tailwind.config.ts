import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	// Explicit paths only; avoid *.js so Tailwind does not scan node_modules. See https://tailwindcss.com/docs/content-configuration
	content: [
		"./index.html",
		"./src/**/*.ts",
		"./src/**/*.tsx",
		"./src/**/*.jsx",
		"./pages/**/*.ts",
		"./pages/**/*.tsx",
		"./pages/**/*.jsx",
		"./components/**/*.ts",
		"./components/**/*.tsx",
		"./components/**/*.jsx",
		"./app/**/*.ts",
		"./app/**/*.tsx",
		"./app/**/*.jsx",
		"!./node_modules/**",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				sans: [
					'JetBrains Mono',
					'Space Mono',
					'ui-monospace',
					'SFMono-Regular',
					'Menlo',
					'Monaco',
					'Consolas',
					'Liberation Mono',
					'Courier New',
					'monospace',
				],
				mono: [
					'JetBrains Mono',
					'Space Mono',
					'ui-monospace',
					'SFMono-Regular',
					'Menlo',
					'Monaco',
					'Consolas',
					'Liberation Mono',
					'Courier New',
					'monospace',
				],
				serif: [
					'ui-serif',
					'Georgia',
					'Cambria',
					'Times New Roman',
					'Times',
					'serif'
				]
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				space: {
					deep: 'hsl(var(--space-deep))',
					nebula: 'hsl(var(--space-nebula))'
				},
				belt: {
					inner: 'hsl(var(--belt-inner))',
					outer: 'hsl(var(--belt-outer))'
				},
				magnetosphere: {
					DEFAULT: 'hsl(var(--magnetosphere))',
					glow: 'hsl(var(--magnetosphere-glow))'
				},
				aurora: 'hsl(var(--aurora))',
				solar: 'hsl(var(--solar-wind))',
				data: {
					green: 'hsl(var(--data-green))',
					yellow: 'hsl(var(--data-yellow))',
					red: 'hsl(var(--data-red))'
				},
				gauss: {
					bg: 'var(--gauss-bg-base)',
					neon: 'var(--gauss-neon-primary)',
					danger: 'var(--gauss-neon-danger)'
				}
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				'orbit': {
					'0%': {
						transform: 'rotateY(0deg)'
					},
					'100%': {
						transform: 'rotateY(360deg)'
					}
				},
				'float': {
					'0%, 100%': {
						transform: 'translateY(0)'
					},
					'50%': {
						transform: 'translateY(-10px)'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'orbit': 'orbit 60s linear infinite',
				'float': 'float 6s ease-in-out infinite'
			},
			backdropBlur: {
				xs: '2px'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
