/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-else-return */
// // eslint-disable-next-line import/no-extraneous-dependencies
// const { JSDOM } = require('jsdom');
// // eslint-disable-next-line import/no-extraneous-dependencies
// const sanitizeHtml = require('sanitize-html');

// function extractMultimedia(element) {
//     if (!element?.tagName) return null;

//     const tagName = element.tagName.toLowerCase();
//     if (['img', 'video', 'audio'].includes(tagName)) {
//         return {
//             type: tagName,
//             src: element.getAttribute('src'),
//             alt: element.getAttribute('alt'),
//             caption: element.getAttribute('caption') || null,
//         };
//     }
//     return null;
// }

// function extractLink(element) {
//     if (!element?.tagName) return null;

//     if (element.tagName.toLowerCase() === 'a') {
//         return {
//             url: element.getAttribute('href'),
//             anchorText: element.textContent.trim(),
//             rel: element.getAttribute('rel'),
//             target: element.getAttribute('target'),
//         };
//     }
//     return null;
// }

// function extractContentBlock(element) {
//     const multimedia = extractMultimedia(element);
//     const link = extractLink(element);
//     if (multimedia) {
//         return { type: 'multimedia', multimedia };
//         // eslint-disable-next-line no-else-return
//     } else if (link) {
//         return { type: 'link', ...link };
//     } else {
//         if (!element?.attributes) return null;

//         return {
//             type: 'text',
//             text: element.textContent.trim(),
//             attributes: Array.from(element.attributes).reduce((acc, attr) => {
//                 acc[attr.name] = attr.value;
//                 return acc;
//             }, {}),
//             children: Array.from(element.childNodes).map(extractContentBlock),
//         };
//     }
// }

// function extractSeoAttributes(document) {
//     const alternates = Array.from(
//         document.querySelectorAll('link[rel="alternate"]')
//     ).map((link) => ({
//         href: link.getAttribute('href'),
//         hreflang: link.getAttribute('hreflang'),
//     }));

//     return {
//         robots:
//             document
//                 .querySelector('meta[name="robots"]')
//                 ?.getAttribute('content') || null,
//         canonical:
//             document
//                 .querySelector('link[rel="canonical"]')
//                 ?.getAttribute('href') || null,
//         alternates: alternates.length ? alternates : null,
//     };
// }

// exports.extractWebPage = (html) => {
//     try {
//         const sanitizedHtml = sanitizeHtml(html);
//         const dom = new JSDOM(sanitizedHtml);
//         const { document } = dom.window;

//         return {
//             title: document.title,
//             content: Array.from(document.body.childNodes).map(
//                 extractContentBlock
//             ),
//             multimedia: Array.from(
//                 document.querySelectorAll('img, video, audio')
//             )
//                 .map(extractMultimedia)
//                 .filter(Boolean),
//             links: Array.from(document.querySelectorAll('a'))
//                 .map(extractLink)
//                 .filter(Boolean),
//             meta: {
//                 description:
//                     document
//                         .querySelector('meta[name="description"]')
//                         ?.getAttribute('content') || null,
//                 keywords:
//                     document
//                         .querySelector('meta[name="keywords"]')
//                         ?.getAttribute('content')
//                         ?.split(',')
//                         .map((k) => k.trim()) || [],
//                 author:
//                     document
//                         .querySelector('meta[name="author"]')
//                         ?.getAttribute('content') || null,
//                 publishDate:
//                     document
//                         .querySelector('meta[name="publishDate"]')
//                         ?.getAttribute('content') || null,
//                 seoAttributes: extractSeoAttributes(document),
//             },
//             css: Array.from(
//                 document.querySelectorAll('link[rel="stylesheet"]')
//             ).map((link) => link.getAttribute('href')),
//             js: Array.from(document.querySelectorAll('script[src]')).map(
//                 (script) => script.getAttribute('src')
//             ),
//         };
//     } catch (error) {
//         console.error(error.stack);
//     }
// };
// const { JSDOM } = require('jsdom');
// const sanitizeHtml = require('sanitize-html');

// function extractAttributes(element) {
//     const attributes = {};
//     // eslint-disable-next-line no-restricted-syntax
//     for (const attr of element.attributes) {
//         attributes[attr.name] = attr.value;
//     }
//     return attributes;
// }

// function extractMultimedia(element) {
//     if (!element?.tagName) return null;
//     const tagName = element.tagName.toLowerCase();
//     if (['img', 'video', 'audio'].includes(tagName)) {
//         return {
//             type: tagName,
//             src: element.getAttribute('src'),
//             alt: element.getAttribute('alt'),
//         };
//     }
//     return null;
// }

// function extractLink(element) {
//     if (!element?.tagName) return null;
//     if (element.tagName.toLowerCase() === 'a') {
//         return {
//             url: element.getAttribute('href'),
//             anchorText: element.textContent.trim(),
//         };
//     }
//     return null;
// }

// function extractContentBlock(element) {
//     if (!element || element.nodeType !== 1) return null; // Only process element nodes
//     const multimedia = extractMultimedia(element);
//     const link = extractLink(element);
//     const attributes = extractAttributes(element);
//     const children = Array.from(element.childNodes)
//         .map(extractContentBlock)
//         .filter(Boolean);

//     if (multimedia) {
//         return { type: 'multimedia', multimedia };
//     } else if (link) {
//         return { type: 'link', ...link };
//     } else {
//         return {
//             type: element.tagName.toLowerCase(),
//             text: element.textContent.trim(),
//             attributes: Object.keys(attributes).length ? attributes : undefined,
//             children: children.length ? children : undefined,
//         };
//     }
// }

// exports.extractWebPage = (html) => {
//     try {
//         const sanitizedHtml = sanitizeHtml(html, {
//             allowedTags: sanitizeHtml.defaults.allowedTags.concat([
//                 'img',
//                 'video',
//                 'audio',
//                 'link',
//                 'meta',
//             ]),
//         });
//         const dom = new JSDOM(sanitizedHtml);
//         const { document } = dom.window;

//         return {
//             title: document.title,
//             content: Array.from(document.body.childNodes)
//                 .map(extractContentBlock)
//                 .filter(Boolean), // This will remove null values from the results
//             multimedia: [], // Need more logic to populate this
//             links: [], // Need more logic to populate this
//             meta: {}, // Need more logic to populate this
//             css: [], // Need more logic to populate this
//             js: [], // Need more logic to populate this
//         };
//     } catch (error) {
//         console.error(error.stack);
//     }
// };

const { JSDOM } = require('jsdom');
const { rawHtml } = require('./rawHtml');
const { cleanCachedString } = require('./utils');

function extractAttributesAndImageLinks(element) {
    let attributes = {};
    Array.from(element.attributes).forEach((attr) => {
        attributes[attr.name] = attr.value;
    });

    const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.nodeValue.trim())
        .join(' ');

    if (directText) {
        attributes['directText'] = directText;
    }

    let imageLinks = Array.from(element.getElementsByTagName('img'))
        .filter((imgElem) => imgElem.hasAttribute('src'))
        .map((imgElem) => imgElem.getAttribute('src'));

    if (imageLinks.length) {
        attributes['imageLinks'] = imageLinks;
    }

    return attributes;
}

function extractHTMLStructure(element, options) {
    if (!element || element.nodeType !== 1) return null;

    const tagName = element.tagName.toLowerCase();

    if (
        options.excludedTags.includes(tagName) ||
        (options.includedTags.length &&
            !options.includedTags.includes(tagName)) ||
        (options.includedClasses.length &&
            !element.classList.some((className) =>
                options.includedClasses.includes(className)
            ))
    )
        return null;

    const attributes = extractAttributesAndImageLinks(element);

    const children = Array.from(element.childNodes)
        .map((child, index) => {
            console.log(`Processing child ${index} of ${tagName}`);
            return extractHTMLStructure(child, options);
        })
        .filter(Boolean);

    if (
        options.excludeEmpty &&
        (!attributes['directText'] ||
            attributes.directText.trim().length === 0) &&
        (!children || !children.length)
    ) {
        return null;
    }

    return {
        tag: tagName,
        attributes: Object.keys(attributes).length ? attributes : undefined,
        children: children.length ? children : undefined,
    };
}

function collectTagsAndClasses(data, tags, classes) {
    if (!data) return [];

    const shouldIncludeByTag = tags?.includes(data.tag);
    const shouldIncludeByClass =
        data.attributes?.class &&
        classes?.some((className) =>
            data.attributes.class.split(' ')?.includes(className)
        );

    const result = shouldIncludeByTag || shouldIncludeByClass ? [data] : [];

    if (data.children) {
        for (const child of data.children) {
            result.push(...collectTagsAndClasses(child, tags, classes));
        }
    }

    return result;
}

exports.extractStructureFromHTML = (html, options = {}) => {
    try {
        const dom = new JSDOM(html);
        const { document } = dom.window;

        const extractionOptions = {
            excludedTags: options?.excludeTags || [],
            includedTags: options?.includeTags || [],
            includedClasses: options?.includeClasses || [],
            excludeEmpty: options?.excludeEmpty || false,
        };

        const result = extractHTMLStructure(document.body, extractionOptions);

        if (options?.includedTags?.length || options?.includedClasses?.length) {
            return collectTagsAndClasses(
                result,
                options.includedTags,
                options.includedClasses
            );
        }

        return result;
    } catch (error) {
        console.error(error.stack);
        return null;
    }
};

// Usage
// const html =
//     '<div><p>Hello, <a href="#">world</a>!</p><img src="image.jpg"></div>';
// const html2 = cleanCachedString(rawHtml.page);
// const structure = exports.extractStructureFromHTML(html2, {
//     excludeTags: ['script', 'iframe'],
//     excludeEmpty: true,
//     includedTags: ['a'],
//     // includedClasses: ['item-product__content'],
// });
// console.log(JSON.stringify(structure, null, 2));
