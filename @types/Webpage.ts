// Multimedia handling: image, video, audio.
interface Multimedia {
    type: 'image' | 'video' | 'audio';
    src: string;
    alt?: string;
    caption?: string;
}

interface Alternate {
    href: string;
    hreflang: string;
}

// SEO-specific and alternate versions.
interface SeoAttributes {
    robots?: string;
    canonical?: string;
    alternates?: Array<Alternate>;
}

// Extended link definition.
interface Link {
    url: string;
    anchorText?: string;
    rel?: string;
    target?: '_blank' | '_self' | '_parent' | '_top';
}

// Meta information with extended SEO attributes.
interface Meta {
    description?: string;
    keywords?: Array<string>;
    author?: string;
    publishDate?: string;
    seoAttributes?: SeoAttributes;
}

interface CustomTag {
    tagName: string;
    attributes?: Record<string, any>;
    textContent?: string;
}

interface ContentBlock {
    type: string;
    text: string;
    attributes?: Record<string, any>;
    multimedia?: Multimedia;
    children?: Array<ContentBlock>;
    customTags?: Array<CustomTag>;
}

interface CustomTag {
    children?: Array<ContentBlock>;
}

// The full webpage structure.
interface WebPage {
    title: string;
    content: Array<ContentBlock>;
    multimedia: Array<Multimedia>;
    links: Array<Link>;
    meta: Meta;
    css?: Array<string>;
    js?: Array<string>;
}
