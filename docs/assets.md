# Ассеты и шрифты

## Демо-мокапы

Для демо с помощью встроенного ImageGen создан атлас изображений. Использованный промпт:

> Use case: product-mockup. Asset type: demo garment mockup sprite atlas for a Russian print editor. Generate one transparent PNG containing two matching views of exactly the same plain white short sleeve crewneck cotton T-shirt, front view on the left and back view on the right, orthographic straight-on, flat lay with subtle realistic folds, no perspective. Each shirt centered in its own half with generous transparent padding, aligned identical scale and height. Torso mostly flat and blank, no logos or text, no print, no shadows outside garment. Front collar deeper, back collar higher. Both shirts fully visible, no overlaps. Aspect ratio 2:1 landscape; transparent background. Demo illustration, not a real product photo.

Атлас разделён на отдельные PNG sharp-ом размером 600 × 680 px: `public/assets/shirt-front.png` и `public/assets/shirt-back.png`. Исходный атлас хранится как `public/assets/shirt-atlas.png`. Каталог указывает мокапы по `/assets/shirt-front.png` и `/assets/shirt-back.png`.

Эти изображения предназначены для демонстрационного редактора и не являются утверждёнными производственными макетами.

## Шрифты

Установлены пакеты `@fontsource/onest`, `@fontsource/noto-sans` и `@fontsource/noto-serif`. Клиент импортирует латинские и кириллические варианты Onest 400/700, Noto Sans 400 и Noto Serif 400. Шрифты распространяются по лицензии SIL Open Font License (OFL). Токены `src/tokens.css` основаны на токенах проекта msuvenirov3.0 и задают Onest как UI-шрифт; Noto Sans/Serif доступны для надписей на макете.

Тексты лицензий находятся в `public/licenses/Onest-OFL.txt`, `public/licenses/NotoSans-OFL.txt` и `public/licenses/NotoSerif-OFL.txt`.
