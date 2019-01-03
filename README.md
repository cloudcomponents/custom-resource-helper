# @cloudcomponents/custom-resource-helper

> A helper for cloudformation custom resources

## Install

```bash
npm install --save @cloudcomponents/custom-resource-helper
```

## How to use

```javascript
const {
  customResourceHelper
} = require('@cloudcomponents/custom-resource-helper');

module.exports.handler = customResourceHandler(
  () => ({
    onCreate: async (event, context, logger) => {
      // Place your code to handle Create events here.
      const physicalResourceId = 'myResourceId';
      const responseData = {};

      return {
        physicalResourceId,
        responseData
      };
    },
    onUpdate: async (event, context, logger) => {
      // Place your code to handle Update events here.
      const physicalResourceId = event.PhysicalResourceId;
      const responseData = {};

      return {
        physicalResourceId,
        responseData
      };
    },
    onDelete: async (event, context, logger) => {
      // Place your code to handle Delete events here
      return;
    }
  })
  /*optional: customLogFactory */
);
```

## Logging

By default log level is set to warning. This can be customized with a custom LogFactory or by defining the "LogLevel" property in the custom resource resource in your template. For example:

```json
"MyCustomResource": {
    "Type": "AWS::CloudFormation::CustomResource",
    "Properties": {
        "LogLevel": "debug",
        //...
    }
}
```