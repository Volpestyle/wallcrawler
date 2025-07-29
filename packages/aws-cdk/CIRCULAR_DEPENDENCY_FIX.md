# Circular Dependency Fix Summary

## Problem
The AWS CDK deployment was failing with a circular dependency error involving:
- LambdaExecutionPolicy01E61603
- BrowserTaskDefinition 
- Lambda functions
- API Gateway resources
- EventBridge rules

## Root Causes
1. **Self-referencing Task Definition**: The BrowserTaskDefinition was referencing its own ARN in the container environment variables
2. **Policy Attachment Timing**: The Lambda execution policy was being attached after creation, creating dependencies
3. **EventBridge Pattern**: The EventBridge rule was trying to match on the task definition ARN

## Solutions Implemented

### 1. Task Definition Environment Variables
Changed from using the full task definition ARN to just the family name:
```typescript
// Before:
ECS_TASK_DEFINITION: browserTaskDefinition.taskDefinitionArn

// After:
ECS_TASK_DEFINITION_FAMILY: 'wallcrawler-browser'
```

### 2. Lambda Execution Role Policies
Moved from separate policy attachment to inline policies:
```typescript
// Before: Created policy separately and attached later
const lambdaPolicy = new iam.Policy(this, 'LambdaExecutionPolicy', {...});
lambdaExecutionRole.attachInlinePolicy(lambdaPolicy);

// After: Inline policies directly in role creation
const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
    inlinePolicies: {
        LambdaBasicPolicy: new iam.PolicyDocument({...})
    }
});
```

### 3. ECS Permissions with Wildcards
Used wildcard patterns for task definitions to avoid circular references:
```typescript
// Before:
resources: [browserTaskDefinition.taskDefinitionArn]

// After:
resources: [`arn:aws:ecs:${this.region}:${this.account}:task-definition/wallcrawler-browser:*`]
```

### 4. EventBridge Rule Pattern
Changed from matching on taskDefinitionArn to using the group field:
```typescript
// Before:
taskDefinitionArn: [{
    prefix: `arn:aws:ecs:${this.region}:${this.account}:task-definition/wallcrawler-browser`
}]

// After:
group: [`family:wallcrawler-browser`]
```

### 5. Go Code Updates
Updated the backend Go code to use the family name:
- Changed environment variable from `ECS_TASK_DEFINITION` to `ECS_TASK_DEFINITION_FAMILY`
- Updated `CreateECSTask` to use just the family name (AWS ECS will use latest revision)
- Fixed container name from "wallcrawler-controller" to "controller" to match CDK

## Files Modified
1. `/packages/aws-cdk/src/lib/wallcrawler-stack.ts` - Main CDK stack file
2. `/packages/backend-go/internal/utils/utils.go` - Go utilities for ECS task creation

## Testing
After these changes, `npx cdk synth` completes successfully without circular dependency errors. The synthesized CloudFormation template shows proper resource dependencies.

## Key Takeaways
- Avoid self-referencing resources in AWS CDK
- Use wildcards or family names instead of full ARNs when possible
- Add IAM permissions using `addToPolicy` after resource creation
- EventBridge patterns should use stable identifiers that don't create circular dependencies