import React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "a-scene": any;
      "a-camera": any;
      "a-assets": any;
      "a-video": any;
      "a-mindar-image-target": any;
      "a-plane": any;
      "a-entity": any;
    }
  }

  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        "a-scene": any;
        "a-camera": any;
        "a-assets": any;
        "a-video": any;
        "a-mindar-image-target": any;
        "a-plane": any;
        "a-entity": any;
      }
    }
  }
}

export {};
