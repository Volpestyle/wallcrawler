export function parseLLMResponse(response: string): string[] {
    return response.split(';').map(action => action.trim());
}

export function validateScript(script: string): boolean {
    const validActions = ['navigate', 'click', 'type', 'observe', 'pause'];
    return script.split(';').every(action => {
        const [type] = action.split(':');
        return validActions.includes(type);
    });
}

export function decodeStreamFrame(data: string): string {
    return data.startsWith('data:image/jpeg;base64,') ? data : `data:image/jpeg;base64,${data}`;
} 