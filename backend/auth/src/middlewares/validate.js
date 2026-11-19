// Valida body, params y query con esquemas zod. Los datos validados quedan en req.valid;
// si algo falla, el ZodError llega al errorHandler (400 VALIDATION_ERROR).
export function validate({ body, params, query } = {}) {
  return (req, res, next) => {
    try {
      req.valid = {
        ...(body && { body: body.parse(req.body) }),
        ...(params && { params: params.parse(req.params) }),
        ...(query && { query: query.parse(req.query) }),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
